#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
This is a web service to print labels on Brother QL label printers.
"""

import sys, logging, random, json, argparse, time, hashlib
from io import BytesIO

from bottle import run, route, get, post, response, request, jinja2_view as view, static_file, redirect
from PIL import Image, ImageDraw, ImageFont
import base64

from brother_ql.devicedependent import models, label_type_specs, label_sizes
from brother_ql.devicedependent import ENDLESS_LABEL, DIE_CUT_LABEL, ROUND_DIE_CUT_LABEL
from brother_ql import BrotherQLRaster, create_label
from brother_ql.backends import backend_factory, guess_backend
from brother_ql.reader import interpret_response

from font_helpers import get_fonts

logger = logging.getLogger(__name__)

LABEL_SIZES = [ (name, label_type_specs[name]['name']) for name in label_sizes]

# Simple in-memory cache for bin label preview PNGs to ensure the exact same
# composed image is used for rasterization shortly after preview.
# key -> { 'png': bytes, 'ts': float }
BIN_LABEL_CACHE = {}

def _build_bin_label_cache_key(text: str, code: str, context: dict, qr_scale: float) -> str:
    payload = {
        't': text or '',
        'c': code or '',
        'ls': context.get('label_size'),
        'fs': int(context.get('font_size', 0)),
        'al': context.get('align'),
        'or': context.get('orientation'),
        'mt': int(context.get('margin_top', 0)),
        'mb': int(context.get('margin_bottom', 0)),
        'ml': int(context.get('margin_left', 0)),
        'mr': int(context.get('margin_right', 0)),
        'qr': float(qr_scale),
    }
    blob = json.dumps(payload, sort_keys=True).encode('utf-8')
    return hashlib.sha256(blob).hexdigest()

def _cache_bin_label_png(key: str, png_bytes: bytes):
    # Keep cache small and fresh
    BIN_LABEL_CACHE[key] = {'png': png_bytes, 'ts': time.time()}
    if len(BIN_LABEL_CACHE) > 100:
        # drop oldest ~20 entries
        items = sorted(BIN_LABEL_CACHE.items(), key=lambda kv: kv[1]['ts'])
        for k, _ in items[:20]:
            BIN_LABEL_CACHE.pop(k, None)

def _get_cached_bin_label_png(key: str, max_age_sec: int = 120) -> bytes:
    ent = BIN_LABEL_CACHE.get(key)
    if not ent:
        return None
    if time.time() - ent['ts'] > max_age_sec:
        BIN_LABEL_CACHE.pop(key, None)
        return None
    return ent['png']

try:
    with open('config.json', encoding='utf-8') as fh:
        CONFIG = json.load(fh)
except FileNotFoundError as e:
    with open('config.example.json', encoding='utf-8') as fh:
        CONFIG = json.load(fh)


@route('/')
def index():
    redirect('/labeldesigner')

@route('/static/<filename:path>')
def serve_static(filename):
    return static_file(filename, root='./static')

@route('/labeldesigner')
@view('labeldesigner.jinja2')
def labeldesigner():
    font_family_names = sorted(list(FONTS.keys()))
    return {'font_family_names': font_family_names,
            'fonts': FONTS,
            'label_sizes': LABEL_SIZES,
            'website': CONFIG['WEBSITE'],
            'label': CONFIG['LABEL']}

def get_label_context(request):
    """ might raise LookupError() """

    d = request.params.decode() # UTF-8 decoded form data

    ff = d.get('font_family')
    if ff is None:
        font_family = None
        font_style = None
    else:
        font_family = ff.rpartition('(')[0].strip()
        font_style  = ff.rpartition('(')[2].rstrip(')')
    # If we have an auto-detected label size, prefer it unless explicitly provided
    autodetected = AUTO_LABEL_SIZE if AUTO_LABEL_SIZE else CONFIG['LABEL']['DEFAULT_SIZE']

    context = {
      'text':          d.get('text', None),
      'font_size': int(d.get('font_size', 100)),
      'font_family':   font_family,
      'font_style':    font_style,
      'label_size':    d.get('label_size', autodetected),
      'kind':          label_type_specs[d.get('label_size', autodetected)]['kind'],
      'margin':    int(d.get('margin', 10)),
      'threshold': int(d.get('threshold', 70)),
      'align':         d.get('align', 'center'),
      'orientation':   d.get('orientation', 'standard'),
      'margin_top':    float(d.get('margin_top',    24))/100.,
      'margin_bottom': float(d.get('margin_bottom', 45))/100.,
      'margin_left':   float(d.get('margin_left',   35))/100.,
      'margin_right':  float(d.get('margin_right',  35))/100.,
    }
    context['margin_top']    = int(context['font_size']*context['margin_top'])
    context['margin_bottom'] = int(context['font_size']*context['margin_bottom'])
    context['margin_left']   = int(context['font_size']*context['margin_left'])
    context['margin_right']  = int(context['font_size']*context['margin_right'])

    # Always draw text/graphics in black; the backend will map to red plane automatically if needed.
    # Using black improves legibility and avoids unintended red artifacts on DK-2251.
    context['fill_color']  = (0, 0, 0)

    def get_font_path(font_family_name, font_style_name):
        try:
            if font_family_name is None or font_style_name is None:
                font_family_name = CONFIG['LABEL']['DEFAULT_FONTS']['family']
                font_style_name =  CONFIG['LABEL']['DEFAULT_FONTS']['style']
            font_path = FONTS[font_family_name][font_style_name]
        except KeyError:
            raise LookupError("Couln't find the font & style")
        return font_path

    context['font_path'] = get_font_path(context['font_family'], context['font_style'])

    def get_label_dimensions(label_size):
        try:
            ls = label_type_specs[context['label_size']]
        except KeyError:
            raise LookupError("Unknown label_size")
        return ls['dots_printable']

    width, height = get_label_dimensions(context['label_size'])
    if height > width: width, height = height, width
    if context['orientation'] == 'rotated': height, width = width, height
    context['width'], context['height'] = width, height

    return context


def _map_media_to_label_identifier(media_width_mm, media_length_mm, media_type):
    """Return the most likely label identifier from measured media width/length.

    media_width_mm: integer mm as reported by device (byte 10)
    media_length_mm: integer mm as reported by device (byte 17) where 0 means continuous
    media_type: string like 'Continuous length tape' or 'Die-cut labels'
    """
    # Translate to string identifiers from label_type_specs
    # For endless, identifiers are widths like '62', '29', etc. For die-cut, '62x29', '29x90', etc.
    # First, find candidates by matching tape_size name or dots width mapping.
    candidates = []
    for ident, spec in label_type_specs.items():
        # Skip color mismatch (we cannot infer red here reliably; allow both)
        # Check form factor vs media_type
        if 'Continuous' in media_type and spec['kind'] != ENDLESS_LABEL:
            continue
        if 'Die-cut' in media_type and spec['kind'] == ENDLESS_LABEL:
            continue
        # Match by nominal mm width (tape_size in mm or name containing width)
        # Many identifiers include width as the first number
        try:
            # Try to read width from identifier or from spec['name']
            # Prefer spec['tape_size'] when available
            tape_size = spec.get('tape_size')
            if tape_size and isinstance(tape_size, (int, float)):
                width_ok = int(round(tape_size)) == int(media_width_mm)
            else:
                # Fallback: parse first number in identifier
                head = ident.split('x')[0].replace('d', '')
                width_ok = head.isdigit() and int(head) == int(media_width_mm)
        except Exception:
            width_ok = False
        if not width_ok:
            continue
        # If die-cut, also try matching length if provided
        if spec['kind'] != ENDLESS_LABEL and media_length_mm:
            # parse length from identifier if possible
            try:
                if 'x' in ident and ident.split('x')[1].isdigit():
                    length_ok = int(ident.split('x')[1]) == int(media_length_mm)
                else:
                    length_ok = True
            except Exception:
                length_ok = True
            if not length_ok:
                continue
        candidates.append(ident)
    # Prefer non-red variant unless length implies otherwise
    if candidates:
        # Prefer plain width code for endless
        endless = [c for c in candidates if 'x' not in c]
        if endless:
            # Prefer standard over red when both present (e.g., '62' vs '62red')
            std = [c for c in endless if 'red' not in c]
            return (std or endless)[0]
        # Else, return the first die-cut candidate
        return candidates[0]
    return None


def autodetect_media_label(printer_specifier):
    """Try to read current media from the device and map to a label identifier.

    Note: only USB backends generally support reading status; network backend often returns nothing.
    """
    selected_backend = guess_backend(printer_specifier)
    backend_class = backend_factory(selected_backend)['backend_class']
    be = backend_class(printer_specifier)
    try:
        # Send init, set automatic status, then explicit status request
        be.write(b"\x1b@\x1bia\x01\x1biS")
        data = be.read(32)
        if not data:
            return None
        resp = interpret_response(data)
        media_width = resp.get('media_width')
        media_length = resp.get('media_length')
        media_type = resp.get('media_type') or ''
        if media_width is None:
            return None
        return _map_media_to_label_identifier(media_width, media_length, media_type)
    finally:
        be.dispose()

def create_label_im(text, **kwargs):
    label_type = kwargs['kind']
    im_font = ImageFont.truetype(kwargs['font_path'], kwargs['font_size'])
    im = Image.new('L', (20, 20), 'white')
    draw = ImageDraw.Draw(im)
    # workaround for a bug in multiline_textsize()
    # when there are empty lines in the text:
    lines = []
    for line in text.split('\n'):
        if line == '': line = ' '
        lines.append(line)
    text = '\n'.join(lines)
    # Pillow >=10 removed getsize/multiline_textsize; use textbbox/multiline_textbbox
    try:
        bbox = draw.multiline_textbbox((0, 0), text, font=im_font, align=kwargs['align'])
        textsize = (bbox[2] - bbox[0], bbox[3] - bbox[1])
    except Exception:
        # Fallback for very old Pillow
        textsize = draw.textsize(text, font=im_font)
    width, height = kwargs['width'], kwargs['height']
    if kwargs['orientation'] == 'standard':
        if label_type in (ENDLESS_LABEL,):
            height = textsize[1] + kwargs['margin_top'] + kwargs['margin_bottom']
    elif kwargs['orientation'] == 'rotated':
        if label_type in (ENDLESS_LABEL,):
            width = textsize[0] + kwargs['margin_left'] + kwargs['margin_right']
    # guard against zero-sized images for safety
    width = max(1, int(width))
    height = max(1, int(height))
    im = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(im)
    # initialize offsets to ensure they are always bound
    horizontal_offset, vertical_offset = 0, 0
    if kwargs['orientation'] == 'standard':
        if label_type in (DIE_CUT_LABEL, ROUND_DIE_CUT_LABEL):
            vertical_offset  = (height - textsize[1])//2
            vertical_offset += (kwargs['margin_top'] - kwargs['margin_bottom'])//2
        else:
            vertical_offset = kwargs['margin_top']
        horizontal_offset = max((width - textsize[0])//2, 0)
    elif kwargs['orientation'] == 'rotated':
        vertical_offset  = (height - textsize[1])//2
        vertical_offset += (kwargs['margin_top'] - kwargs['margin_bottom'])//2
        if label_type in (DIE_CUT_LABEL, ROUND_DIE_CUT_LABEL):
            horizontal_offset = max((width - textsize[0])//2, 0)
        else:
            horizontal_offset = kwargs['margin_left']
    offset = horizontal_offset, vertical_offset
    draw.multiline_text(offset, text, kwargs['fill_color'], font=im_font, align=kwargs['align'])
    return im

@route('/api/preview/text', method=['OPTIONS'])
def options_preview_image():
    # CORS preflight
    response.set_header('Access-Control-Allow-Origin', '*')
    response.set_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    response.set_header('Access-Control-Allow-Headers', 'Content-Type')
    return ''

@get('/api/preview/text')
@post('/api/preview/text')
def get_preview_image():
    try:
        context = get_label_context(request)
    except Exception as e:
        response.status = 400
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})
    im = create_label_im(**context)
    return_format = request.query.get('return_format', 'png')
    if return_format == 'base64':
        import base64
        response.set_header('Content-type', 'text/plain')
        response.set_header('Access-Control-Allow-Origin', '*')
        return base64.b64encode(image_to_png_bytes(im)).decode('ascii')
    else:
        response.set_header('Content-type', 'image/png')
        response.set_header('Access-Control-Allow-Origin', '*')
        return image_to_png_bytes(im)

def image_to_png_bytes(im):
    image_buffer = BytesIO()
    im.save(image_buffer, format="PNG")
    image_buffer.seek(0)
    return image_buffer.read()

def _compose_bin_label_image(text, code, context, qr_scale: float = 0.9, auto_fit_text: bool = True):
    width, height = int(context['width']), int(context['height'])
    ml, mr = int(context['margin_left']), int(context['margin_right'])
    mt, mb = int(context['margin_top']), int(context['margin_bottom'])

    # Prepare font and QR first to decide final dimensions for endless labels
    base_font_size = int(context['font_size'])
    im_font = ImageFont.truetype(context['font_path'], base_font_size)
    dummy = Image.new('RGB', (10, 10), 'white')
    ddraw = ImageDraw.Draw(dummy)
    try:
        bbox = ddraw.multiline_textbbox((0,0), text or ' ', font=im_font, align=context['align'])
        text_w0, text_h0 = (bbox[2] - bbox[0], bbox[3] - bbox[1])
    except Exception:
        text_w0, text_h0 = ddraw.textsize(text or ' ', font=im_font)

    # Auto-increase font size to fill available cross-tape height for endless labels
    # (only when requested; default true for bin endpoints).
    # For standard orientation, the cross dimension is the initial 'height'.
    if auto_fit_text and context['kind'] == ENDLESS_LABEL:
        available_cross_h = max(1, int(context['height']) - mt - mb)
        if text_h0 < available_cross_h and base_font_size > 0:
            try:
                scale_factor = min(3.0, available_cross_h / max(1, float(text_h0)))
                new_size = max(10, int(base_font_size * scale_factor * 0.98))
                im_font = ImageFont.truetype(context['font_path'], new_size)
                try:
                    bbox = ddraw.multiline_textbbox((0,0), text or ' ', font=im_font, align=context['align'])
                    text_w0, text_h0 = (bbox[2] - bbox[0], bbox[3] - bbox[1])
                except Exception:
                    text_w0, text_h0 = ddraw.textsize(text or ' ', font=im_font)
            except Exception as e:
                logger.debug("Auto-fit increase failed: %s", e)

    qr_im, qr_size = None, 0
    if code:
        try:
            import qrcode
            qr = qrcode.QRCode(border=1, box_size=4)
            qr.add_data(code)
            qr.make(fit=True)
            qr_im = qr.make_image(fill_color='black', back_color='white').convert('RGB')
        except Exception as e:
            logger.warning("QR generation failed: %s", e)
            qr_im = None

    # For endless labels, compute dimension dynamically to fit content
    if context['kind'] == ENDLESS_LABEL:
        if context['orientation'] == 'standard':
            # Height grows with content
            # Make QR as tall as possible within available height
            qr_size = int(max(1, qr_scale * (text_h0 + mt + mb)))
            content_h = max(text_h0, qr_size)
            height = content_h + mt + mb
        else:  # rotated
            # Width grows with content width
            qr_size = int(max(1, qr_scale * text_h0))
            content_w = text_w0 + (qr_size + 8 if qr_im else 0)
            width = content_w + ml + mr

    # Clamp
    width = max(1, width)
    height = max(1, height)

    # Ensure integer pixel dimensions
    width = int(round(width))
    height = int(round(height))
    # Build canvas and draw
    im = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(im)

    avail_w = max(1, width - ml - mr)
    avail_h = max(1, height - mt - mb)

    # Fit QR to available area, and ensure there's reasonable room for text
    if qr_im is not None:
        qr_size = int(min(max(1, qr_size), avail_h))
        # Keep at least 40% of width for text in standard orientation
        max_qr_w = int(max(1, avail_w * 0.60))
        if context['orientation'] == 'standard':
            qr_size = min(qr_size, max_qr_w)
        if qr_size > 0:
            qr_im = qr_im.resize((qr_size, qr_size), Image.NEAREST)

    gap = 8 if (qr_im is not None and qr_size > 0) else 0
    # Text area placement depends on orientation
    if context['orientation'] == 'standard':
        text_x = ml + (qr_size + gap)
        text_y = mt
        text_w = max(1, avail_w - (qr_size + gap))
        text_h = avail_h
        # Draw QR
        if qr_im is not None and qr_size > 0:
            im.paste(qr_im, (ml, mt + max((avail_h - qr_size)//2, 0)))
    else:  # rotated orientation, keep same placement rules
        text_x = ml + (qr_size + gap)
        text_y = mt
        text_w = max(1, avail_w - (qr_size + gap))
        text_h = avail_h
        if qr_im is not None and qr_size > 0:
            im.paste(qr_im, (ml, mt + max((avail_h - qr_size)//2, 0)))

    # Word-wrap text to available width
    def wrap_text_to_width(dd, raw_text, font, max_w):
        if not raw_text:
            return ' '
        lines = []
        for para in (raw_text.split('\n') or [' '] ):
            words = para.split(' ')
            cur = ''
            for w in words:
                cand = (cur + ' ' + w).strip() if cur else w
                try:
                    bb = dd.textbbox((0,0), cand, font=font)
                    cand_w = bb[2] - bb[0]
                except Exception:
                    cand_w, _ = dd.textsize(cand, font=font)
                if cand_w <= max_w or not cur:
                    cur = cand
                else:
                    lines.append(cur)
                    cur = w
            lines.append(cur or ' ')
        return '\n'.join(lines)

    wrapped_text = wrap_text_to_width(draw, text or ' ', im_font, text_w)

    # Measure wrapped text and adjust font if needed
    def measure(dd, s, font):
        try:
            bb = dd.multiline_textbbox((0,0), s, font=font, align=context['align'])
            return (bb[2]-bb[0], bb[3]-bb[1])
        except Exception:
            return dd.textsize(s, font=font)

    t_w, t_h = measure(draw, wrapped_text, im_font)

    # If auto-fit, try to increase font until hitting height or width limits
    if auto_fit_text:
        target_h = text_h
        iters = 0
        last_ok_font = im_font
        last_ok_dims = (t_w, t_h)
        while iters < 12 and t_h < target_h * 0.98:
            iters += 1
            next_size = int(im_font.size * 1.12)
            trial_font = ImageFont.truetype(context['font_path'], next_size)
            trial_wrapped = wrap_text_to_width(draw, text or ' ', trial_font, text_w)
            tw, th = measure(draw, trial_wrapped, trial_font)
            if th <= target_h and tw <= text_w:
                im_font = trial_font
                wrapped_text = trial_wrapped
                t_w, t_h = tw, th
                last_ok_font, last_ok_dims = im_font, (t_w, t_h)
            else:
                break
        # If overflow after loop, fallback to last ok
        im_font = last_ok_font
        t_w, t_h = last_ok_dims

    # If still overflowing on height or width, decrease font until it fits
    guard = 0
    while (t_h > text_h or t_w > text_w) and im_font.size > 10 and guard < 12:
        guard += 1
        im_font = ImageFont.truetype(context['font_path'], max(10, int(im_font.size * 0.9)))
        wrapped_text = wrap_text_to_width(draw, text or ' ', im_font, text_w)
        t_w, t_h = measure(draw, wrapped_text, im_font)

    vy = text_y + max((text_h - t_h) // 2, 0)
    if context['align'] == 'left':
        vx = text_x
    elif context['align'] == 'right':
        vx = text_x + max(text_w - t_w, 0)
    else:
        vx = text_x + max((text_w - t_w) // 2, 0)
    draw.multiline_text((vx, vy), wrapped_text or ' ', context['fill_color'], font=im_font, align=context['align'])
    return im

@post('/api/print/text')
@get('/api/print/text')
def print_text():
    """Deprecated: server-side printing is disabled. Use WebUSB with /api/print/prepare."""
    response.status = 410
    response.set_header('Content-type', 'application/json')
    response.set_header('Access-Control-Allow-Origin', '*')
    return json.dumps({'success': False, 'message': 'Server-side printing disabled. Use WebUSB (Connect USB, then Print).'})


@route('/api/print/prepare', method=['OPTIONS'])
def options_prepare_print_data():
    # CORS preflight
    response.set_header('Access-Control-Allow-Origin', '*')
    response.set_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    response.set_header('Access-Control-Allow-Headers', 'Content-Type')
    return ''

@post('/api/print/prepare')
@get('/api/print/prepare')
def prepare_print_data():
    """
    Prepare print data (raster instructions) and return as base64 for client-side printing (e.g., WebUSB).
    """
    try:
        context = get_label_context(request)
    except Exception as e:
        response.status = 400
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})

    if context['text'] is None:
        response.status = 400
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': 'Please provide the text for the label'})

    im = create_label_im(**context)
    if context['kind'] == ENDLESS_LABEL:
        rotate = 0 if context['orientation'] == 'standard' else 90
    elif context['kind'] in (ROUND_DIE_CUT_LABEL, DIE_CUT_LABEL):
        rotate = 'auto'

    qlr = BrotherQLRaster(CONFIG['PRINTER']['MODEL'])
    red = False
    if 'red' in context['label_size']:
        red = True
    try:
        create_label(qlr, im, context['label_size'], red=red, threshold=context['threshold'], cut=True, rotate=rotate)
    except Exception as e:
        response.status = 500
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})

    import base64, json
    response.set_header('Content-type', 'application/json')
    response.set_header('Access-Control-Allow-Origin', '*')
    b64 = base64.b64encode(qlr.data).decode('ascii')
    return json.dumps({'data': b64})

@route('/api/preview/bin_label', method=['OPTIONS'])
def options_preview_bin_label():
    response.set_header('Access-Control-Allow-Origin', '*')
    response.set_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    response.set_header('Access-Control-Allow-Headers', 'Content-Type')
    return ''

@post('/api/preview/bin_label')
@get('/api/preview/bin_label')
def preview_bin_label():
    try:
        context = get_label_context(request)
    except Exception as e:
        response.status = 400
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})
    d = request.params.decode()
    text = d.get('text', '') or ' '
    code = d.get('code', '')
    try:
        qr_scale = float(d.get('qr_scale', 0.9))
    except Exception:
        qr_scale = 0.9
    auto_fit_text = str(d.get('auto_fit_text', '1')).lower() in ('1','true','yes','on')
    im = _compose_bin_label_image(text, code, context, qr_scale=qr_scale, auto_fit_text=auto_fit_text)
    png_bytes = image_to_png_bytes(im)
    # store to cache with deterministic key
    key = _build_bin_label_cache_key(text, code, context, qr_scale)
    _cache_bin_label_png(key, png_bytes)
    response.set_header('Content-type', 'image/png')
    response.set_header('Access-Control-Allow-Origin', '*')
    return png_bytes

@route('/api/print/prepare_bin_label', method=['OPTIONS'])
def options_prepare_bin_label():
    response.set_header('Access-Control-Allow-Origin', '*')
    response.set_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    response.set_header('Access-Control-Allow-Headers', 'Content-Type')
    return ''

@post('/api/print/prepare_bin_label')
@get('/api/print/prepare_bin_label')
def prepare_bin_label():
    try:
        context = get_label_context(request)
    except Exception as e:
        response.status = 400
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})
    d = request.params.decode()
    text = d.get('text', '') or ' '
    code = d.get('code', '')
    try:
        qr_scale = float(d.get('qr_scale', 0.9))
    except Exception:
        qr_scale = 0.9
    auto_fit_text = str(d.get('auto_fit_text', '1')).lower() in ('1','true','yes','on')
    # Try to reuse cached composed image if preview just happened
    key = _build_bin_label_cache_key(text, code, context, qr_scale)
    cached_png = _get_cached_bin_label_png(key)
    if cached_png:
        try:
            im = Image.open(BytesIO(cached_png)).convert('RGB')
        except Exception:
            im = _compose_bin_label_image(text, code, context, qr_scale=qr_scale, auto_fit_text=auto_fit_text)
    else:
        im = _compose_bin_label_image(text, code, context, qr_scale=qr_scale, auto_fit_text=auto_fit_text)

    if context['kind'] == ENDLESS_LABEL:
        rotate = 0 if context['orientation'] == 'standard' else 90
    elif context['kind'] in (ROUND_DIE_CUT_LABEL, DIE_CUT_LABEL):
        rotate = 'auto'

    qlr = BrotherQLRaster(CONFIG['PRINTER']['MODEL'])
    red = 'red' in context['label_size']
    try:
        create_label(qlr, im, context['label_size'], red=red, threshold=context['threshold'], cut=True, rotate=rotate)
    except Exception as e:
        response.status = 500
        response.set_header('Content-type', 'application/json')
        response.set_header('Access-Control-Allow-Origin', '*')
        return json.dumps({'error': str(e)})
    response.set_header('Content-type', 'application/json')
    response.set_header('Access-Control-Allow-Origin', '*')
    b64 = base64.b64encode(qlr.data).decode('ascii')
    return json.dumps({'data': b64})

def main():
    global DEBUG, FONTS, BACKEND_CLASS, CONFIG, AUTO_LABEL_SIZE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default=False)
    parser.add_argument('--loglevel', type=lambda x: getattr(logging, x.upper()), default=False)
    parser.add_argument('--font-folder', default=False, help='folder for additional .ttf/.otf fonts')
    parser.add_argument('--default-label-size', default=False, help='Label size inserted in your printer. Defaults to 62.')
    parser.add_argument('--default-orientation', default=False, choices=('standard', 'rotated'), help='Label orientation, defaults to "standard". To turn your text by 90°, state "rotated".')
    parser.add_argument('--model', default=False, choices=models, help='The model of your printer (default: QL-500)')
    parser.add_argument('printer',  nargs='?', default=False, help='String descriptor for the printer to use (like tcp://192.168.0.23:9100 or file:///dev/usb/lp0)')
    args = parser.parse_args()

    if args.printer:
        CONFIG['PRINTER']['PRINTER'] = args.printer

    if args.port:
        PORT = args.port
    else:
        PORT = CONFIG['SERVER']['PORT']

    if args.loglevel:
        LOGLEVEL = args.loglevel
    else:
        LOGLEVEL = CONFIG['SERVER']['LOGLEVEL']

    if LOGLEVEL == 'DEBUG':
        DEBUG = True
    else:
        DEBUG = False

    if args.model:
        CONFIG['PRINTER']['MODEL'] = args.model

    if args.default_label_size:
        CONFIG['LABEL']['DEFAULT_SIZE'] = args.default_label_size

    if args.default_orientation:
        CONFIG['LABEL']['DEFAULT_ORIENTATION'] = args.default_orientation

    if args.font_folder:
        ADDITIONAL_FONT_FOLDER = args.font_folder
    else:
        ADDITIONAL_FONT_FOLDER = CONFIG['SERVER']['ADDITIONAL_FONT_FOLDER']


    logging.basicConfig(level=LOGLEVEL)

    try:
        selected_backend = guess_backend(CONFIG['PRINTER']['PRINTER'])
    except ValueError:
        parser.error("Couln't guess the backend to use from the printer string descriptor")
    BACKEND_CLASS = backend_factory(selected_backend)['backend_class']

    # Attempt media auto-detection (non-fatal on failure)
    AUTO_LABEL_SIZE = None
    try:
        AUTO_LABEL_SIZE = autodetect_media_label(CONFIG['PRINTER']['PRINTER'])
        if AUTO_LABEL_SIZE:
            logger.info("Auto-detected label size: %s", AUTO_LABEL_SIZE)
            # Keep UI default from config; auto-detected is used only as runtime fallback in get_label_context
    except Exception as e:
        logger.debug("Media auto-detection failed: %s", e)

    if CONFIG['LABEL']['DEFAULT_SIZE'] not in label_sizes:
        parser.error("Invalid --default-label-size. Please choose on of the following:\n:" + " ".join(label_sizes))

    FONTS = get_fonts()
    if ADDITIONAL_FONT_FOLDER:
        FONTS.update(get_fonts(ADDITIONAL_FONT_FOLDER))

    if not FONTS:
        sys.stderr.write("Not a single font was found on your system. Please install some or use the \"--font-folder\" argument.\n")
        sys.exit(2)

    selected_font = None
    try:
        for font in CONFIG['LABEL']['DEFAULT_FONTS']:
            try:
                FONTS[font['family']][font['style']]
                selected_font = font
                logger.debug("Selected the following default font: {}".format(font))
                break
            except Exception:
                continue
    except Exception:
        # If structure unexpected, ignore and pick random below
        pass
    if selected_font is None:
        sys.stderr.write('Could not find any of the default fonts. Choosing a random one.\n')
        family = random.choice(list(FONTS.keys()))
        style = random.choice(list(FONTS[family].keys()))
        selected_font = {'family': family, 'style': style}
        sys.stderr.write('The default font is now set to: {family} ({style})\n'.format(**selected_font))
    CONFIG['LABEL']['DEFAULT_FONTS'] = selected_font

    run(host=CONFIG['SERVER']['HOST'], port=PORT, debug=DEBUG)

if __name__ == "__main__":
    main()
