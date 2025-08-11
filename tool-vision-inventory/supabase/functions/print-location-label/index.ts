import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LocationData {
  id: string
  qr_code: string
  name: string
  type: string
  description?: string
  capacity?: number
}

// Generate a more detailed QR code representation for Brother QL printing
function generateQRMatrix(text: string, size: number = 25): number[][] {
  // Create a simple matrix representation of QR code
  // In production, you'd use a proper QR code library
  const matrix: number[][] = []
  
  for (let y = 0; y < size; y++) {
    matrix[y] = []
    for (let x = 0; x < size; x++) {
      // Create a pattern based on text hash and position
      const hash = text.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
      const pattern = (x + y + hash) % 3
      matrix[y][x] = pattern === 0 ? 1 : 0
    }
  }
  
  // Add finder patterns (corners)
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
        matrix[i][j] = 1
        matrix[i][size - 1 - j] = 1
        matrix[size - 1 - i][j] = 1
      }
    }
  }
  
  return matrix
}

// Convert QR matrix to bitmap data for Brother QL
function qrMatrixToBitmap(matrix: number[][], scale: number = 8): Uint8Array {
  const size = matrix.length * scale
  const bytesPerLine = Math.ceil(size / 8)
  const bitmap = new Uint8Array(size * bytesPerLine)
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const matrixY = Math.floor(y / scale)
      const matrixX = Math.floor(x / scale)
      const pixel = matrix[matrixY] && matrix[matrixY][matrixX] ? 1 : 0
      
      if (pixel) {
        const byteIndex = y * bytesPerLine + Math.floor(x / 8)
        const bitIndex = 7 - (x % 8)
        bitmap[byteIndex] |= (1 << bitIndex)
      }
    }
  }
  
  return bitmap
}

// Generate Brother QL-800 print commands with options
function generateBrotherQLLabel(location: LocationData, opts: { autoFormat?: boolean; twoColor?: boolean } = {}): Uint8Array {
  const { autoFormat = false, twoColor = false } = opts
  const commands: number[] = []
  
  // Initialize printer
  commands.push(0x1B, 0x40) // ESC @ - Initialize
  
  // Expanded mode (two-color flag if requested)
  commands.push(0x1B, 0x69, 0x4B, twoColor ? 0x01 : 0x00)

  if (autoFormat) {
    // Auto format mode - let printer detect and use current media
    commands.push(
      // Auto cut every label
      0x1B, 0x69, 0x41, 0x01,
      // Set margin (~3mm)
      0x1B, 0x69, 0x64, 0x23, 0x00,
      // Switch to raster mode
      0x1B, 0x69, 0x52, 0x01,
      // Auto cut ON (Set each mode bit 6)
      0x1B, 0x69, 0x4D, 0x40
    )
  } else {
    // Manual format mode with specific media settings (62mm red/black)
    commands.push(
      // Status information request
      0x1B, 0x69, 0x53,
      // Set media & quality for 62mm continuous; leave length 0; printer detects DK-2251
      0x1B, 0x69, 0x7A, 0x8F, 0x00, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Set margin (0.1" = ~3mm = 35 dots at 300 DPI)
      0x1B, 0x69, 0x64, 0x23, 0x00,
      // Switch to raster mode
      0x1B, 0x69, 0x52, 0x01,
      // Auto cut ON (Set each mode bit 6)
      0x1B, 0x69, 0x4D, 0x40,
      // Feed amount every label
      0x1B, 0x69, 0x41, 0x01
    )
  }
  
// Generate QR code bitmap
const qrMatrix = generateQRMatrix(location.qr_code, 25)
const qrBitmap = qrMatrixToBitmap(qrMatrix, 6)

// Calculate label dimensions (62mm = 696 pixels at 300 DPI)
const labelWidth = 696
const labelHeight = 200
const bytesPerLine = Math.ceil(labelWidth / 8) // 87

// Create label bitmaps (black plane always; red plane optional)
const blackBitmap = new Uint8Array(labelHeight * bytesPerLine)
const redBitmap = twoColor ? new Uint8Array(labelHeight * bytesPerLine) : undefined

// Add QR code to black plane (position at left side)
const qrSize = 25 * 6 // 150 pixels
const qrStartX = 20
const qrStartY = 25

for (let y = 0; y < Math.min(qrSize, labelHeight - qrStartY); y++) {
  for (let x = 0; x < Math.min(qrSize, labelWidth - qrStartX); x++) {
    const qrByteIndex = y * Math.ceil(qrSize / 8) + Math.floor(x / 8)
    const qrBitIndex = 7 - (x % 8)
    
    if (qrBitmap[qrByteIndex] & (1 << qrBitIndex)) {
      const labelY = qrStartY + y
      const labelX = qrStartX + x
      const byteIndex = labelY * bytesPerLine + Math.floor(labelX / 8)
      const bitIndex = 7 - (labelX % 8)
      blackBitmap[byteIndex] |= (1 << bitIndex)
    }
  }
}

// Simple text pattern for location name (first 10 chars) onto black plane
const textStartX = 200
const textStartY = 40
const name = location.name.substring(0, 10).toUpperCase()
for (let i = 0; i < name.length; i++) {
  const char = name.charCodeAt(i)
  const charX = textStartX + i * 24
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      if ((char + x + y) % 3 === 0) {
        const labelY = textStartY + y
        const labelX = charX + x
        if (labelY < labelHeight && labelX < labelWidth) {
          const byteIndex = labelY * bytesPerLine + Math.floor(labelX / 8)
          const bitIndex = 7 - (labelX % 8)
          blackBitmap[byteIndex] |= (1 << bitIndex)
        }
      }
    }
  }
}

// If two-color, draw a red banner across the bottom
if (twoColor && redBitmap) {
  const bandHeight = 30
  for (let y = labelHeight - bandHeight; y < labelHeight; y++) {
    for (let x = 0; x < labelWidth; x++) {
      const byteIndex = y * bytesPerLine + Math.floor(x / 8)
      const bitIndex = 7 - (x % 8)
      redBitmap[byteIndex] |= (1 << bitIndex)
    }
  }
}

// Send raster data
for (let line = 0; line < labelHeight; line++) {
  if (twoColor && redBitmap) {
    // Black plane first
    commands.push(0x77, 0x01, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF)
    const start = line * bytesPerLine
    for (let i = 0; i < bytesPerLine; i++) commands.push(blackBitmap[start + i])
    // Red plane second
    commands.push(0x77, 0x02, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF)
    for (let i = 0; i < bytesPerLine; i++) commands.push(redBitmap[start + i])
  } else {
    // Single color
    commands.push(0x67, 0x00, bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF)
    const start = line * bytesPerLine
    for (let i = 0; i < bytesPerLine; i++) commands.push(blackBitmap[start + i])
  }
}

// Print command
commands.push(0x1A) // Print and feed

return new Uint8Array(commands)
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { locationId, autoFormat = false, twoColor = false } = await req.json()
    
    if (!locationId) {
      return new Response(
        JSON.stringify({ error: 'Location ID is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get location data from database
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: location, error } = await supabase
      .from('locations')
      .select('*')
      .eq('id', locationId)
      .single()

    if (error || !location) {
      console.error('Error fetching location:', error)
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    console.log('Generating print commands for location:', location.name, 'Auto-format:', autoFormat)

    // Generate Brother QL print commands with auto-format option
    const printCommands = generateBrotherQLLabel(location, { autoFormat, twoColor })

    console.log('Print commands generated successfully for:', location.qr_code)
    console.log('Command length:', printCommands.length, 'bytes')

    return new Response(
      JSON.stringify({ 
        success: true,
        printData: Array.from(printCommands),
        location: {
          name: location.name,
          qr_code: location.qr_code,
          type: location.type
        },
        message: `Label ready for ${location.name}`,
        commandLength: printCommands.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error generating print commands:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to generate print commands', details: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})