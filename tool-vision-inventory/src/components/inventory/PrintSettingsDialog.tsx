import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { Orientation } from './PrinterService';
import { printerService } from './PrinterService';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function PrintSettingsDialog({ open, onOpenChange }: Props) {
  const s = printerService.settings;
  const [labelSize, setLabelSize] = useState(s.labelSize);
  const [fontSize, setFontSize] = useState<number>(s.fontSize);
  const [align, setAlign] = useState<'left'|'center'|'right'>(s.align);
  const [orientation, setOrientation] = useState<Orientation>(s.orientation);
  const [marginTop, setMarginTop] = useState<number>(s.margins.top);
  const [marginBottom, setMarginBottom] = useState<number>(s.margins.bottom);
  const [marginLeft, setMarginLeft] = useState<number>(s.margins.left);
  const [marginRight, setMarginRight] = useState<number>(s.margins.right);
  const [binPrefix, setBinPrefix] = useState<string>(s.presets.bin.prefix);
  const [binIncludeQr, setBinIncludeQr] = useState<boolean>(s.presets.bin.includeQr);
  const [itemIncludeBrand, setItemIncludeBrand] = useState<boolean>(s.presets.item.includeBrand);
  const [itemIncludeModel, setItemIncludeModel] = useState<boolean>(s.presets.item.includeModel);
  const [printDelayMs, setPrintDelayMs] = useState<number>(s.printDelayMs || 0);

  useEffect(() => {
    if (open) {
      const cur = printerService.settings;
      setLabelSize(cur.labelSize);
      setFontSize(cur.fontSize);
      setAlign(cur.align);
      setOrientation(cur.orientation);
      setMarginTop(cur.margins.top);
      setMarginBottom(cur.margins.bottom);
      setMarginLeft(cur.margins.left);
      setMarginRight(cur.margins.right);
      setBinPrefix(cur.presets.bin.prefix);
      setBinIncludeQr(cur.presets.bin.includeQr);
      setItemIncludeBrand(cur.presets.item.includeBrand);
      setItemIncludeModel(cur.presets.item.includeModel);
      setPrintDelayMs(cur.printDelayMs || 0);
    }
  }, [open]);

  const save = () => {
    printerService.updateSettings({
      labelSize,
      fontSize,
      align,
      orientation,
      margins: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
      printDelayMs,
      presets: {
        bin: { prefix: binPrefix, includeQr: binIncludeQr },
        item: { includeBrand: itemIncludeBrand, includeModel: itemIncludeModel },
      }
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Print Settings</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label>Label Size</Label>
            <Select value={labelSize} onValueChange={setLabelSize}>
              <SelectTrigger>
                <SelectValue placeholder="Select label size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="62">62mm (endless)</SelectItem>
                <SelectItem value="62red">62mm (red/black)</SelectItem>
                <SelectItem value="29">29mm (endless)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Font Size</Label>
            <Input type="number" min={10} max={200} value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value || 70))} />
          </div>

          <div className="space-y-2">
            <Label>Alignment</Label>
            <Select value={align} onValueChange={(v: any) => setAlign(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Orientation</Label>
            <Select value={orientation} onValueChange={(v: any) => setOrientation(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="rotated">Rotated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Margins (%) Top / Bottom</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={0} max={200} value={marginTop}
                onChange={(e) => setMarginTop(Number(e.target.value || 0))} />
              <Input type="number" min={0} max={200} value={marginBottom}
                onChange={(e) => setMarginBottom(Number(e.target.value || 0))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Margins (%) Left / Right</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={0} max={200} value={marginLeft}
                onChange={(e) => setMarginLeft(Number(e.target.value || 0))} />
              <Input type="number" min={0} max={200} value={marginRight}
                onChange={(e) => setMarginRight(Number(e.target.value || 0))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Auto Print Delay (ms)</Label>
            <Input type="number" min={0} step={100} value={printDelayMs}
              onChange={(e) => setPrintDelayMs(Number(e.target.value || 0))} />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <h4 className="text-sm font-semibold">Bin Label Preset</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prefix</Label>
              <Input value={binPrefix} onChange={(e) => setBinPrefix(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="block">Include QR</Label>
              <input type="checkbox" checked={binIncludeQr} onChange={(e) => setBinIncludeQr(e.target.checked)} />
            </div>
          </div>
          <h4 className="text-sm font-semibold">Item Label Preset</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="block">Include Brand</Label>
              <input type="checkbox" checked={itemIncludeBrand} onChange={(e) => setItemIncludeBrand(e.target.checked)} />
            </div>
            <div className="space-y-2">
              <Label className="block">Include Model</Label>
              <input type="checkbox" checked={itemIncludeModel} onChange={(e) => setItemIncludeModel(e.target.checked)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

