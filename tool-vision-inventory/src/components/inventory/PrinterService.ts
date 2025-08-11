// WebUSB API types for Brother QL printers
interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly manufacturerName: string;
  readonly configuration: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
}

interface USBConfiguration {
  readonly configurationValue: number;
}

interface USBOutTransferResult {
  readonly status: 'ok' | 'stall' | 'babble';
  readonly bytesWritten: number;
}

interface USBInTransferResult {
  readonly status: 'ok' | 'stall' | 'babble';
  readonly data: DataView;
}

interface PrinterService {
  isConnected: boolean;
  connect: () => Promise<boolean>;
  print: (data: number[]) => Promise<boolean>;
  disconnect: () => void;
  settings: PrintSettings;
  updateSettings: (s: Partial<PrintSettings>) => void;
}
export type Orientation = 'standard' | 'rotated';

export interface PrintSettings {
  labelSize: string; // e.g. '62' or '62red'
  fontSize: number;  // default 70
  align: 'left' | 'center' | 'right';
  orientation: Orientation;
  margins: { top: number; bottom: number; left: number; right: number };
  // Optional delay before auto printing (ms)
  printDelayMs?: number;
  presets: {
    bin: { prefix: string; includeQr: boolean };
    item: { includeBrand: boolean; includeModel: boolean };
  };
}

import { createBrotherQLPrintJob, BrotherQLRaster } from '../../utils/brotherQL';
import { preparePrintDataFromBrotherWeb } from '@/lib/brotherWeb';

class BrotherQLPrinterService implements PrinterService {
  private device: USBDevice | null = null;
  private outEndpoint: number = 2;
  private inEndpoint: number = 1;
  public isConnected = false;
  private lastPaperInfo: any = null;
  public settings: PrintSettings = {
    labelSize: '62red',
    fontSize: 70,
    align: 'center',
    orientation: 'standard',
    margins: { top: 24, bottom: 45, left: 35, right: 35 },
    printDelayMs: 0,
    presets: {
      bin: { prefix: 'BIN', includeQr: true },
      item: { includeBrand: true, includeModel: true },
    }
  };

  updateSettings(s: Partial<PrintSettings>) {
    this.settings = {
      ...this.settings,
      ...s,
      margins: { ...this.settings.margins, ...(s.margins || {}) },
    };
  }

  async connect(): Promise<boolean> {
    try {
      // Check if WebUSB API is supported
      if (!('usb' in navigator)) {
        throw new Error('WebUSB API not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.');
      }

      console.log('Requesting Brother QL printer connection via WebUSB...');

      // Request Brother QL device
      this.device = await (navigator as any).usb.requestDevice({
        filters: [
          {
            vendorId: 0x04f9, // Brother vendor ID
            classCode: 7,     // Printer class
          },
          {
            vendorId: 0x04f9, // Brother vendor ID  
            productId: 0x209b // QL-800 product ID
          },
          {
            vendorId: 0x04f9, // Brother vendor ID
            productId: 0x2100 // Alternative QL-800 product ID
          }
        ]
      });

      if (!this.device) {
        throw new Error('No Brother QL printer selected');
      }

      console.log('Brother QL printer found:', this.device.productName || 'Unknown Model');
      console.log('Vendor ID:', this.device.vendorId.toString(16));
      console.log('Product ID:', this.device.productId.toString(16));

      // Open the device
      await this.device.open();
      console.log('Device opened successfully');

      // Ensure configuration is selected
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }

      // Find the Printer class interface (class 7) and its alt setting
      const conf: any = (this.device as any).configuration;
      const iface = conf.interfaces.find((i: any) => i.alternates?.some((a: any) => a.interfaceClass === 7));
      if (!iface) throw new Error('Printer interface (class 7) not found');
      const alt = iface.alternates.find((a: any) => a.interfaceClass === 7) || iface.alternates?.[0];
      await this.device.claimInterface(iface.interfaceNumber);
      try {
        await (this.device as any).selectAlternateInterface?.(iface.interfaceNumber, alt.alternateSetting);
      } catch (_) {}
      const outEp = alt.endpoints?.find((e: any) => e.direction === 'out');
      const inEp = alt.endpoints?.find((e: any) => e.direction === 'in');
      if (!outEp) throw new Error('Printer OUT endpoint not found');
      this.outEndpoint = outEp.endpointNumber;
      this.inEndpoint = inEp ? inEp.endpointNumber : 0; // some models may not expose IN
      console.log(`Using OUT endpoint: ${this.outEndpoint}, IN endpoint: ${this.inEndpoint || 'none'}`);

      // Store claimed interface number
      (this.device as any).claimedInterface = iface.interfaceNumber;

      this.isConnected = true;
      console.log('Successfully connected to Brother QL printer via WebUSB!');
      return true;

    } catch (error) {
      console.error('Failed to connect to Brother QL printer:', error);
      console.error('Troubleshooting steps:');
      console.error('1. Ensure Brother QL-800 is connected via USB');
      console.error('2. Make sure printer is powered on');
      console.error('3. Use Chrome/Edge browser (not Firefox/Safari)');
      console.error('4. Try disconnecting and reconnecting the USB cable');
      console.error('5. Close any Brother P-touch Editor or other printer software');
      
      this.isConnected = false;
      this.device = null;
      return false;
    }
  }

  async print(data: number[]): Promise<boolean> {
    if (!this.device || !this.isConnected) {
      throw new Error('Brother QL printer not connected');
    }

    try {
      console.log('Sending print data to Brother QL printer via WebUSB...');
      console.log('Data length:', data.length, 'bytes');

      // Convert data to Uint8Array  
      const uint8Data = new Uint8Array(data);
      
      // Send data in chunks to avoid transfer size limits (like working implementation)
      const CHUNK_SIZE = 16 * 1024; // 16KB chunks
      
      for (let offset = 0; offset < uint8Data.length; offset += CHUNK_SIZE) {
        const chunk = uint8Data.subarray(offset, Math.min(offset + CHUNK_SIZE, uint8Data.length));
        const result = await this.device.transferOut(this.outEndpoint, chunk);
        
        if (result.status !== 'ok') {
          console.error('Print transfer failed with status:', result.status);
          return false;
        }
      }
      
      console.log('Print data sent successfully via WebUSB');
      return true;

    } catch (error) {
      console.error('Failed to print via WebUSB:', error);
      return false;
    }
  }

  async getStatus(): Promise<any> {
    if (!this.device || !this.isConnected) {
      throw new Error('Brother QL printer not connected');
    }

    try {
      console.log('Requesting printer status...');
      // Request status information
      const statusRequest = new Uint8Array([0x1B, 0x69, 0x53]);

      const readOnce = async () => {
        await this.device!.transferOut(this.outEndpoint, statusRequest.buffer);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await this.device!.transferIn(this.inEndpoint, 32);
        const data = res.status === 'ok' && res.data?.byteLength ? new Uint8Array(res.data.buffer) : new Uint8Array();
        return { res, data } as const;
      };

      // First read
      let { res, data } = await readOnce();

      // Retry once if empty/short
      if (data.length < 32) {
        console.warn('Empty/short status response; retrying...');
        await new Promise((resolve) => setTimeout(resolve, 250));
        ({ res, data } = await readOnce());
      }

      if (res.status === 'ok' && data.length >= 32) {
        console.log('Status response:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        // Decode status/error flags for diagnostics
        const decoded = this.decodeStatus(data);
        if (decoded.errors.length) {
          console.warn('Printer errors:', decoded.errors.join(', '));
        } else {
          console.log(`Printer OK. Status: ${decoded.statusType}, Phase: ${decoded.phaseType}`);
        }
        // Parse paper information from status response
        const paperInfo = this.parsePaperInfo(data);
        console.log('Detected paper:', paperInfo);
        if (paperInfo) this.lastPaperInfo = paperInfo;
        return paperInfo;
      }

      console.warn('No valid status received; using last known media if available.');
      if (this.lastPaperInfo) return this.lastPaperInfo;
      return null;
    } catch (error) {
      console.error('Failed to get printer status:', error);
      return this.lastPaperInfo ?? null;
    }
    }
    private parsePaperInfo(statusData: Uint8Array): any {
      // Brother QL status byte layout (per Command Reference)
      // Byte 10: Media width (mm)
      // Byte 11: Media type (0x0A: Continuous, 0x0B: Die-cut)
      // Byte 17: Media length (mm for die-cut, 0 for continuous)
      
      if (!statusData || statusData.length < 32) {
        console.error('Invalid status data received:', statusData);
        return null;
      }
      
      const mediaWidthMm = statusData[10];
      const mediaTypeVal = statusData[11];
      const mediaLengthMm = statusData[17];
      
      if (mediaWidthMm === undefined || mediaTypeVal === undefined || mediaLengthMm === undefined) {
        console.error('Could not parse media info from status data');
        return null;
      }
      
      const mediaTypeLabel =
        mediaTypeVal === 0x0A ? 'Continuous length tape' :
        mediaTypeVal === 0x0B ? 'Die-cut label' :
        `Unknown (0x${mediaTypeVal.toString(16)})`;
      
      console.log(`Media type: ${mediaTypeLabel} (0x${mediaTypeVal.toString(16)}), Width: ${mediaWidthMm}mm, Length: ${mediaLengthMm === 0 ? 'Continuous' : mediaLengthMm + 'mm'}`);
      
      // Compute print area width in dots (62mm known to be 696 dots at 300dpi)
      const printWidth =
        mediaWidthMm === 62 ? 696 : Math.round((mediaWidthMm / 25.4) * 300);
    
      // Bytes per raster line based on print width
      const bytesPerLine = Math.ceil(printWidth / 8);
      
      return {
        type: mediaTypeVal,
        width: mediaWidthMm,
        length: mediaLengthMm,
        printWidth,
        bytesPerLine,
        isEndless: mediaTypeVal === 0x0A
      };
    }

  // Decode error/status flags from 32‑byte status response
  private decodeStatus(statusData: Uint8Array) {
    const err1 = statusData[8] ?? 0;
    const err2 = statusData[9] ?? 0;
    const statusType = statusData[18] ?? 0;
    const phaseType = statusData[19] ?? 0;

    const ERR1: Record<number, string> = {
      0: 'No media when printing',
      1: 'End of media (die-cut size only)',
      2: 'Tape cutter jam',
      3: 'Not used',
      4: 'Main unit in use',
      5: 'Printer turned off',
      6: 'High-voltage adapter (n/u)',
      7: 'Fan error',
    };
    const ERR2: Record<number, string> = {
      0: 'Replace media error',
      1: 'Expansion buffer full',
      2: 'Transmission/Communication error',
      3: 'Communication buffer full (n/u)',
      4: 'Cover opened while printing',
      5: 'Cancel key (n/u)',
      6: 'Media cannot be fed',
      7: 'System error',
    };

    const errors: string[] = [];
    for (let bit = 0; bit < 8; bit++) {
      if (err1 & (1 << bit)) errors.push(ERR1[bit] ?? `Err1 bit${bit}`);
      if (err2 & (1 << bit)) errors.push(ERR2[bit] ?? `Err2 bit${bit}`);
    }

    const STATUS: Record<number, string> = {
      0x00: 'Reply to status request',
      0x01: 'Printing completed',
      0x02: 'Error occurred',
      0x05: 'Notification',
      0x06: 'Phase change',
    };
    const PHASE: Record<number, string> = {
      0x00: 'Waiting to receive',
      0x01: 'Printing state',
    };

    return {
      errors,
      statusType: STATUS[statusType] ?? `Unknown (0x${statusType.toString(16)})`,
      phaseType: PHASE[phaseType] ?? `Unknown (0x${phaseType.toString(16)})`,
    };
  }
  async testPrint(): Promise<boolean> {
    if (!this.device || !this.isConnected) {
      throw new Error('Brother QL printer not connected');
    }

    try {
      console.log('Requesting test print data from Brother Web...');
      // Try to detect media and select best-matching label identifier
      let labelSize = '62';
      try {
        const media = await this.getStatus();
        if (media && media.isEndless && media.width) {
          labelSize = String(media.width); // e.g., '62', '29'
        }
      } catch (e) {
        console.warn('Could not detect media, defaulting to 62:', e);
      }
      const prep = await preparePrintDataFromBrotherWeb({
        text: 'TEST',
        labelSize: this.settings.labelSize || labelSize,
        fontSize: this.settings.fontSize,
        align: this.settings.align,
        orientation: this.settings.orientation,
        marginTop: this.settings.margins.top,
        marginBottom: this.settings.margins.bottom,
        marginLeft: this.settings.margins.left,
        marginRight: this.settings.margins.right,
      });
      if (!prep.ok || !prep.data) {
        console.error('Brother Web prepare failed:', prep.error);
        return false;
      }
      // Use chunked send for reliability
      return await this.print(Array.from(prep.data));

    } catch (error) {
      console.error('Failed to send Brother QL test print:', error);
      return false;
    }
  }

  async testPrintTwoColor(): Promise<boolean> {
    if (!this.device || !this.isConnected) {
      throw new Error('Brother QL printer not connected');
    }

    try {
      console.log('Requesting two-color test data from Brother Web...');
      // Two-color requires DK-2251 installed (62mm red/black)
      const prep = await preparePrintDataFromBrotherWeb({
        text: 'DEMO',
        labelSize: this.settings.labelSize,
        fontSize: this.settings.fontSize,
        align: this.settings.align,
        orientation: this.settings.orientation,
        marginTop: this.settings.margins.top,
        marginBottom: this.settings.margins.bottom,
        marginLeft: this.settings.margins.left,
        marginRight: this.settings.margins.right,
      });
      if (!prep.ok || !prep.data) {
        console.error('Brother Web prepare failed:', prep.error);
        return false;
      }
      return await this.print(Array.from(prep.data));
    } catch (error) {
      console.error('Brother QL two-color test failed:', error);
      return false;
    }
  }

  async testPrintWordRed(word: string = 'TEST'): Promise<boolean> {
    if (!this.device || !this.isConnected) {
      throw new Error('Brother QL printer not connected');
    }

    try {
      console.log(`Creating red "${word}" print using Brother QL library...`);

      const printCommands = createBrotherQLPrintJob({
        text: word,
        labelSize: '62red', 
        twoColor: true,
        fontSize: 70,
        width: 696,
        height: 96
      });

      console.log('Generated', printCommands.length, 'bytes for red word print');

      const data = new Uint8Array(printCommands);
      const result = await this.device.transferOut(this.outEndpoint, data.buffer);
      
      if (result.status === 'ok') {
        console.log('Brother QL red word print sent successfully');
        return true;
      } else {
        console.error('Red word print failed with status:', result.status);
        return false;
      }
    } catch (error) {
      console.error('Brother QL red word print failed:', error);
      return false;
    }
  }

  disconnect(): void {
    if (this.device) {
      try {
        const iface = (this.device as any).claimedInterface ?? 0;
        // Release the claimed interface if possible
        (this.device as any).releaseInterface?.(iface);
        this.device.close();
        console.log('Brother QL printer disconnected');
      } catch (error) {
        console.error('Error disconnecting printer:', error);
      }
      this.device = null;
      this.isConnected = false;
    }
  }
}

// Singleton printer service
export const printerService = new BrotherQLPrinterService();

// Auto-print function using Supabase edge function with status reporting
export async function autoPrintLabel(
  locationId: string, 
  onStatusUpdate?: (status: string) => void
): Promise<{ success: boolean; message: string }> {
  try {
    onStatusUpdate?.('Connecting to printer...');
    
    // Connect to printer if not already connected
    if (!printerService.isConnected) {
      console.log('Printer not connected, attempting to connect...');
      const connected = await printerService.connect();
      if (!connected) {
        return {
          success: false,
          message: 'Failed to connect to Brother QL printer via WebUSB. Please ensure it\'s connected via USB and try again.'
        };
      }
    }

    onStatusUpdate?.('Generating label data...');

    // Prefer local Brother Web prepare with current settings and location name
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: locRow, error: locErr } = await supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .single();

    let prepared: Uint8Array | null = null;
    if (!locErr && locRow?.name) {
      const s = printerService.settings;
      console.log('Preparing label via Brother Web for location name:', locRow.name);
      const prep = await preparePrintDataFromBrotherWeb({
        text: locRow.name,
        labelSize: s.labelSize,
        fontSize: s.fontSize,
        align: s.align,
        orientation: s.orientation,
        marginTop: s.margins.top,
        marginBottom: s.margins.bottom,
        marginLeft: s.margins.left,
        marginRight: s.margins.right,
      });
      if (prep.ok && prep.data) {
        prepared = prep.data;
      } else {
        console.warn('Brother Web prepare failed, will try edge function:', prep.error);
      }
    }

    // Fallback to edge function if needed, passing settings along
    if (!prepared) {
      console.log('Requesting print data from edge function for location:', locationId);
      const s = printerService.settings;
      const { data: result, error } = await supabase.functions.invoke('print-location-label', {
        body: {
          locationId,
          autoFormat: true,
          twoColor: s.labelSize.includes('red'),
          settings: {
            labelSize: s.labelSize,
            fontSize: s.fontSize,
            align: s.align,
            orientation: s.orientation,
            margins: s.margins,
          },
        }
      });
      if (error || !result?.success || !Array.isArray(result.printData)) {
        throw new Error(error?.message || result?.error || 'Failed to generate print data');
      }
      // Convert number[] to Uint8Array
      prepared = new Uint8Array(result.printData);
    }

    onStatusUpdate?.('Sending to printer...');
    // Optional adjustable delay before printing
    const delayMs = Math.max(0, Number(printerService.settings.printDelayMs || 0));
    if (delayMs > 0) {
      onStatusUpdate?.(`Waiting ${delayMs}ms before printing...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const printed = await printerService.print(Array.from(prepared));
    
    if (printed) {
      onStatusUpdate?.('Print complete!');
      return {
        success: true,
        message: `Label printed successfully for ${result.location.name}!`
      };
    } else {
      return {
        success: false,
        message: 'Failed to send data to Brother QL printer via WebUSB'
      };
    }

  } catch (error) {
    console.error('Auto-print error:', error);
    return {
      success: false,
      message: `Print failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test print function
export async function testPrint(): Promise<{ success: boolean; message: string }> {
  try {
    // Connect to printer if not already connected
    if (!printerService.isConnected) {
      console.log('Printer not connected, attempting to connect...');
      const connected = await printerService.connect();
      if (!connected) {
        return {
          success: false,
          message: 'Failed to connect to Brother QL printer. Please ensure it\'s connected via USB and try again.'
        };
      }
    }

    console.log('Requesting TEST label via Brother Web prepare...');
    const printed = await printerService.testPrint();
    
    if (printed) {
      return {
        success: true,
        message: 'Test print sent successfully! Check your printer for output.'
      };
    } else {
      return {
        success: false,
        message: 'Failed to send test print to Brother QL printer'
      };
    }

  } catch (error) {
    console.error('Test print error:', error);
    return {
      success: false,
      message: `Test print failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Two-color DK-2251 test print (red/black)
export async function testPrintTwoColor(): Promise<{ success: boolean; message: string }> {
  try {
    if (!printerService.isConnected) {
      console.log('Printer not connected, attempting to connect...');
      const connected = await printerService.connect();
      if (!connected) {
        return { success: false, message: 'Failed to connect to Brother QL printer.' };
      }
    }
    const ok = await printerService.testPrintTwoColor();
    if (ok) {
      return { success: true, message: 'Two-color test sent successfully!' };
    }
    return { success: false, message: 'Two-color test failed to send.' };
  } catch (e) {
    return { success: false, message: `Two-color test failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
  }
}

// Browser compatibility check
export function isPrintingSupported(): boolean {
  return 'usb' in navigator;
}

// Manual printer connection for first-time setup
export async function setupPrinter(): Promise<boolean> {
  if (!isPrintingSupported()) {
    alert('WebUSB API is not supported in your browser. Please use Chrome, Edge, or another Chromium-based browser.');
    return false;
  }

  return await printerService.connect();
}
