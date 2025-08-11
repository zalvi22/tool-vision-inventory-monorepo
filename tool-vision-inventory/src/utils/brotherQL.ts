
// Brother QL printer utilities based on the Python brother_ql library
// Command reference implementation for WebUSB printing

export interface BrotherQLConfig {
  model: string;
  dpi: number;
  printWidth: number;
  bytesPerLine: number;
}

export const BROTHER_QL_MODELS: Record<string, BrotherQLConfig> = {
  'QL-800': {
    model: 'QL-800',
    dpi: 300,
    printWidth: 696, // 62mm at 300 DPI
    bytesPerLine: 87
  },
  'QL-700': {
    model: 'QL-700', 
    dpi: 300,
    printWidth: 696,
    bytesPerLine: 87
  }
};

export interface LabelSpec {
  identifier: string;
  name: string;
  kind: 'endless' | 'die_cut' | 'round_die_cut';
  width_mm: number;
  height_mm?: number;
  dots_printable: [number, number];
  tape_size?: number;
}

export const LABEL_SIZES: Record<string, LabelSpec> = {
  '62': {
    identifier: '62',
    name: '62mm endless',
    kind: 'endless',
    width_mm: 62,
    dots_printable: [696, 0],
    tape_size: 62
  },
  '62red': {
    identifier: '62red',
    name: '62mm endless red/black',
    kind: 'endless', 
    width_mm: 62,
    dots_printable: [696, 0],
    tape_size: 62
  },
  '29': {
    identifier: '29',
    name: '29mm endless',
    kind: 'endless',
    width_mm: 29,
    dots_printable: [306, 0],
    tape_size: 29
  }
};

export class BrotherQLRaster {
  private data: number[] = [];
  private model: string;
  private config: BrotherQLConfig;

  constructor(model: string = 'QL-800') {
    this.model = model;
    this.config = BROTHER_QL_MODELS[model] || BROTHER_QL_MODELS['QL-800'];
  }

  // Initialize printer - equivalent to ESC @
  initialize(): void {
    this.data.push(0x1B, 0x40);
  }

  // Set automatic status notifications
  setStatus(): void {
    this.data.push(0x1B, 0x69, 0x21, 0x01);
  }

  // Enable/disable two-color mode
  setTwoColorMode(enabled: boolean): void {
    this.data.push(0x1B, 0x69, 0x4B, enabled ? 0x01 : 0x00);
  }

  // Set auto cut mode
  setAutoCut(enabled: boolean): void {
    this.data.push(0x1B, 0x69, 0x4D, enabled ? 0x40 : 0x00);
  }

  // Set margin (in dots)
  setMargin(dots: number): void {
    this.data.push(0x1B, 0x69, 0x64, dots & 0xFF, (dots >> 8) & 0xFF);
  }

  // Set media information - equivalent to ESC i z
  setMedia(widthMm: number, lengthMm: number, rasterLines: number, isEndless: boolean = true): void {
    this.data.push(
      0x1B, 0x69, 0x7A, // ESC i z
      0x8F,             // n1 flags (high quality)
      isEndless ? 0x0A : 0x0B, // n2 media type
      widthMm & 0xFF,   // n3 width in mm
      lengthMm & 0xFF,  // n4 length in mm (0 for continuous)
      rasterLines & 0xFF, (rasterLines >> 8) & 0xFF, 0x00, 0x00, // n5-n8 raster lines
      0x00, 0x00        // n9-n10 reserved
    );
  }

  // Switch to raster mode - equivalent to ESC i R
  enterRasterMode(): void {
    this.data.push(0x1B, 0x69, 0x52, 0x01);
  }

  // Set feed amount
  setFeedAmount(amount: number): void {
    this.data.push(0x1B, 0x69, 0x41, amount & 0xFF);
  }

  // Add single color raster line (black only)
  addRasterLine(lineData: number[]): void {
    const bytesPerLine = lineData.length;
    // 0x67 = uncompressed black raster, 0x00 = no compression
    this.data.push(0x67, 0x00, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF);
    this.data.push(...lineData);
  }

  // Add two-color raster line (red and black planes)
  addTwoColorRasterLine(redData: number[], blackData: number[]): void {
    const bytesPerLine = redData.length;
    
    // Red plane first (0x77 0x02)
    this.data.push(0x77, 0x02, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF);
    this.data.push(...redData);
    
    // Black plane second (0x77 0x01)  
    this.data.push(0x77, 0x01, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF);
    this.data.push(...blackData);
  }

  // Print and feed - equivalent to FS q or 0x1A
  print(): void {
    this.data.push(0x1A);
  }

  // Get the complete command data
  getData(): number[] {
    return [...this.data];
  }

  // Clear the command buffer
  clear(): void {
    this.data = [];
  }

  // Create a complete print job for text
  createTextLabel(text: string, options: {
    labelSize: string;
    fontSize: number;
    twoColor?: boolean;
    width?: number;
    height?: number;
  }): number[] {
    const { labelSize, fontSize, twoColor = false, width = 696, height = 100 } = options;
    const labelSpec = LABEL_SIZES[labelSize] || LABEL_SIZES['62'];
    const bytesPerLine = Math.ceil(width / 8);

    this.clear();
    this.initialize();
    this.setStatus();
    this.setTwoColorMode(twoColor);
    this.setAutoCut(true);
    this.setMargin(35); // ~3mm margin
    
    if (twoColor) {
      this.setMedia(labelSpec.width_mm, 0, height, true);
    }
    
    this.enterRasterMode();
    this.setFeedAmount(1);

    // Generate simple bitmap for text
    for (let y = 0; y < height; y++) {
      if (twoColor) {
        const redLine = new Array(bytesPerLine).fill(0);
        const blackLine = new Array(bytesPerLine).fill(0);
        
        // Add border to black plane
        if (y < 3 || y >= height - 3) {
          blackLine.fill(0xFF);
        } else {
          blackLine[0] = 0xFF;
          blackLine[1] = 0xFF;
          blackLine[bytesPerLine - 1] = 0xFF;
          blackLine[bytesPerLine - 2] = 0xFF;
        }

        // Add red text area
        if (y >= Math.floor(height / 2) - 8 && y <= Math.floor(height / 2) + 8) {
          for (let i = 10; i < bytesPerLine - 10; i++) {
            redLine[i] = 0xFF;
          }
        }

        this.addTwoColorRasterLine(redLine, blackLine);
      } else {
        const line = new Array(bytesPerLine).fill(0);
        
        // Simple border pattern
        if (y < 3 || y >= height - 3 || y >= Math.floor(height / 2) - 2 && y <= Math.floor(height / 2) + 2) {
          line.fill(0xFF);
        } else {
          line[0] = 0xFF;
          line[1] = 0xFF;
          line[bytesPerLine - 1] = 0xFF;
          line[bytesPerLine - 2] = 0xFF;
        }

        this.addRasterLine(line);
      }
    }

    this.print();
    return this.getData();
  }
}

// Helper function to create a Brother QL print job
export function createBrotherQLPrintJob(options: {
  text: string;
  labelSize: string;
  model?: string;
  twoColor?: boolean;
  fontSize?: number;
  width?: number;
  height?: number;
}): number[] {
  const qlr = new BrotherQLRaster(options.model || 'QL-800');
  return qlr.createTextLabel(options.text, {
    labelSize: options.labelSize,
    fontSize: options.fontSize || 70,
    twoColor: options.twoColor || false,
    width: options.width || 696,
    height: options.height || 100
  });
}
