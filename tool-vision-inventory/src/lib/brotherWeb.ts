// Integration with Brother QL Web service (/api/print/prepare)
// Prepares raster data server-side, then caller can send to printer via WebUSB

export interface PrepareOptions {
  text: string;
  fontFamily?: string; // e.g., "DejaVu Serif (Book)"; omit to use server default
  fontSize?: number;   // default server 100
  labelSize?: string;  // e.g., '62', '62red' ; omit for server default/autodetect
  align?: 'left' | 'center' | 'right';
  orientation?: 'standard' | 'rotated';
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
}

export interface PrepareResult {
  ok: boolean;
  data?: Uint8Array;
  error?: string;
}

export function getBrotherWebBaseUrl(): string {
  const fromEnv = (import.meta as any)?.env?.VITE_BROTHER_WEB_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || 'http://localhost:8013';
}

export async function preparePrintDataFromBrotherWeb(
  options: PrepareOptions,
  baseUrl: string = getBrotherWebBaseUrl()
): Promise<PrepareResult> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/print/prepare`;
    const params = new URLSearchParams();
    params.set('text', options.text && options.text.length ? options.text : ' ');
    if (options.fontFamily) params.set('font_family', options.fontFamily);
    if (options.fontSize) params.set('font_size', String(options.fontSize));
    if (options.labelSize) params.set('label_size', options.labelSize);
    if (options.align) params.set('align', options.align);
    if (options.orientation) params.set('orientation', options.orientation);
    if (typeof options.marginTop === 'number') params.set('margin_top', String(options.marginTop));
    if (typeof options.marginBottom === 'number') params.set('margin_bottom', String(options.marginBottom));
    if (typeof options.marginLeft === 'number') params.set('margin_left', String(options.marginLeft));
    if (typeof options.marginRight === 'number') params.set('margin_right', String(options.marginRight));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      // Allow CORS, server must reply with ACAO
      mode: 'cors',
    });
    const json = await res.json().catch(async () => {
      const text = await res.text();
      throw new Error(text);
    });
    if (!res.ok) {
      return { ok: false, error: typeof json === 'string' ? json : json?.error || 'Server error' };
    }
    if (!json?.data) {
      return { ok: false, error: json?.error || 'No data returned' };
    }
    // Robust base64 decode (handle URL-safe and missing padding)
    const normalized = (json.data as string).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    return { ok: true, data: bytes };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to prepare print data' };
  }
}

export async function previewLabelFromBrotherWeb(
  options: PrepareOptions,
  baseUrl: string = getBrotherWebBaseUrl()
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/preview/text?return_format=base64`;
    const params = new URLSearchParams();
    params.set('text', options.text && options.text.length ? options.text : ' ');
    if (options.fontFamily) params.set('font_family', options.fontFamily);
    if (options.fontSize) params.set('font_size', String(options.fontSize));
    if (options.labelSize) params.set('label_size', options.labelSize);
    if (options.align) params.set('align', options.align);
    if (options.orientation) params.set('orientation', options.orientation);
    if (typeof options.marginTop === 'number') params.set('margin_top', String(options.marginTop));
    if (typeof options.marginBottom === 'number') params.set('margin_bottom', String(options.marginBottom));
    if (typeof options.marginLeft === 'number') params.set('margin_left', String(options.marginLeft));
    if (typeof options.marginRight === 'number') params.set('margin_right', String(options.marginRight));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      mode: 'cors',
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text.slice(0, 200) };
    const dataUrl = `data:image/png;base64,${text}`;
    return { ok: true, dataUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to preview label' };
  }
}

export async function previewBinLabel(
  text: string,
  code: string,
  options: PrepareOptions,
  baseUrl: string = getBrotherWebBaseUrl()
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/preview/bin_label`;
    const params = new URLSearchParams();
    params.set('text', text && text.length ? text : ' ');
    if (code) params.set('code', code);
    if (options.fontFamily) params.set('font_family', options.fontFamily);
    if (options.fontSize) params.set('font_size', String(options.fontSize));
    if (options.labelSize) params.set('label_size', options.labelSize);
    if (options.align) params.set('align', options.align);
    if (options.orientation) params.set('orientation', options.orientation);
    if (typeof options.marginTop === 'number') params.set('margin_top', String(options.marginTop));
    if (typeof options.marginBottom === 'number') params.set('margin_bottom', String(options.marginBottom));
    if (typeof options.marginLeft === 'number') params.set('margin_left', String(options.marginLeft));
    if (typeof options.marginRight === 'number') params.set('margin_right', String(options.marginRight));
  if ((options as any).qr_scale !== undefined) params.set('qr_scale', String((options as any).qr_scale));
  if ((options as any).auto_fit_text !== undefined) params.set('auto_fit_text', String((options as any).auto_fit_text));
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: params, mode: 'cors' });
    const blob = await res.blob();
    if (!res.ok) return { ok: false, error: 'Server error' };
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    return { ok: true, dataUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to preview bin label' };
  }
}

export async function prepareBinLabel(
  text: string,
  code: string,
  options: PrepareOptions,
  baseUrl: string = getBrotherWebBaseUrl()
): Promise<PrepareResult> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/print/prepare_bin_label`;
    const params = new URLSearchParams();
    params.set('text', text && text.length ? text : ' ');
    if (code) params.set('code', code);
    if (options.fontFamily) params.set('font_family', options.fontFamily);
    if (options.fontSize) params.set('font_size', String(options.fontSize));
    if (options.labelSize) params.set('label_size', options.labelSize);
    if (options.align) params.set('align', options.align);
    if (options.orientation) params.set('orientation', options.orientation);
    if (typeof options.marginTop === 'number') params.set('margin_top', String(options.marginTop));
    if (typeof options.marginBottom === 'number') params.set('margin_bottom', String(options.marginBottom));
    if (typeof options.marginLeft === 'number') params.set('margin_left', String(options.marginLeft));
    if (typeof options.marginRight === 'number') params.set('margin_right', String(options.marginRight));
  if ((options as any).qr_scale !== undefined) params.set('qr_scale', String((options as any).qr_scale));
  if ((options as any).auto_fit_text !== undefined) params.set('auto_fit_text', String((options as any).auto_fit_text));
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: params, mode: 'cors' });
    const json = await res.json();
    if (!res.ok || !json?.data) return { ok: false, error: json?.error || 'Server error' };
    const normalized = (json.data as string).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    return { ok: true, data: bytes };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to prepare bin label' };
  }
}
