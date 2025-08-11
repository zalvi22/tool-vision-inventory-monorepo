import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { printerService } from './PrinterService';
import { previewBinLabel, prepareBinLabel } from '@/lib/brotherWeb';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; onAdded?: () => void };

export default function VisionAddItemDialog({ open, onOpenChange, onAdded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      if (!open) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        toast({ title: 'Camera error', description: (e as any)?.message || 'Cannot access camera', variant: 'destructive' });
      }
    })();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [open]);

  const captureAndIdentify = async () => {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      // Grab frame
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      // Optional: try barcode decode first (fast path)
      let detectedName: string | null = null;
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const luminanceSource = await (reader as any).createLuminanceSourceFromImage(canvas);
        const result = reader.decodeOneFromLuminanceSource(luminanceSource);
        if (result?.text) {
          detectedName = result.text;
        }
      } catch (_) {}

      // If no barcode, fallback to lightweight COCO-SSD model for class label
      if (!detectedName) {
        try {
          const coco = await import('@tensorflow-models/coco-ssd');
          const tf = await import('@tensorflow/tfjs');
          const model = await coco.load({ base: 'lite_mobilenet_v2' as any });
          const predictions = await model.detect(canvas);
          if (predictions?.length) {
            // Pick top label with confidence
            const top = predictions.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
            detectedName = `${top.class} (${Math.round((top.score || 0)*100)}%)`;
          }
        } catch (_) {}
      }

      if (detectedName) setName(detectedName);
      else toast({ title: 'No item detected', description: 'Adjust framing/lighting and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const saveAndPrint = async () => {
    try {
      setBusy(true);
      const { data, error } = await supabase
        .from('items')
        .insert([{ name: name || 'Unknown Item', brand: brand || null, model: model || null, category: 'Other', quantity: 1, quantity_unit: 'pcs' }])
        .select()
        .single();
      if (error) throw error;

      // Auto print item label with QR ITEM-<id>
      try {
        if (!printerService.isConnected) {
          await printerService.connect();
        }
        const s = printerService.settings;
        const lines: string[] = [data.name];
        const second: string[] = [];
        if (s.presets.item.includeBrand && data.brand) second.push(data.brand);
        if (s.presets.item.includeModel && data.model) second.push(data.model);
        if (second.length) lines.push(second.join(' '));
        const text = lines.join('\n');
        const code = `ITEM-${data.id}`;
        // preview to warm cache
        await previewBinLabel(text, code, {
          text,
          labelSize: s.labelSize,
          fontSize: s.fontSize,
          align: s.align,
          orientation: s.orientation,
          marginTop: s.margins.top,
          marginBottom: s.margins.bottom,
          marginLeft: s.margins.left,
          marginRight: s.margins.right,
          qr_scale: 0.9,
          auto_fit_text: false as any,
        });
        const prep = await prepareBinLabel(text, code, {
          text,
          labelSize: s.labelSize,
          fontSize: s.fontSize,
          align: s.align,
          orientation: s.orientation,
          marginTop: s.margins.top,
          marginBottom: s.margins.bottom,
          marginLeft: s.margins.left,
          marginRight: s.margins.right,
          qr_scale: 0.9,
          auto_fit_text: false as any,
        });
        if (prep.ok && prep.data) {
          await printerService.print(Array.from(prep.data));
        }
      } catch (e) {
        console.warn('Auto-print failed:', e);
      }
      onAdded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || 'Could not save item', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scan Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <video ref={videoRef} className="w-full rounded border" muted playsInline />
          <div className="flex gap-2">
            <Button onClick={captureAndIdentify} disabled={busy}>Capture & Identify</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Model</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={saveAndPrint} disabled={busy || !name}>Save & Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

