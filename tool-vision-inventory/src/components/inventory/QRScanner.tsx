import { useState, useRef, useEffect } from "react";
import { X, Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface QRScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QRScanner({ open, onOpenChange }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && isScanning) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [open, isScanning]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        // Start scanning for QR codes
        scanForQRCode();
      }
    } catch (error) {
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please check permissions.",
        variant: "destructive"
      });
      setIsScanning(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const scanForQRCode = () => {
    // This is a simplified QR code scanner
    // In a real implementation, you would use a library like jsQR
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scan = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Here you would integrate with a QR code library like jsQR
        // For now, we'll simulate QR code detection
        
        // Simulate finding a QR code after 3 seconds
        setTimeout(() => {
          if (isScanning) {
            const mockQRCode = `LOC-${Date.now()}-SAMPLE`;
            handleQRCodeDetected(mockQRCode);
          }
        }, 3000);
      }
      
      if (isScanning) {
        requestAnimationFrame(scan);
      }
    };
    
    scan();
  };

  const handleQRCodeDetected = (code: string) => {
    setScannedCode(code);
    setIsScanning(false);
    stopCamera();
    
    toast({
      title: "QR Code Scanned",
      description: `Found code: ${code}`,
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // In a real implementation, you would process the image file
      // to extract QR codes using a library
      toast({
        title: "File Upload",
        description: "QR code scanning from images is not yet implemented",
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan QR Code</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {!isScanning && !scannedCode && (
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">
                Scan a QR code to find location or item details
              </p>
              
              <div className="flex gap-2 justify-center">
                <Button onClick={() => setIsScanning(true)}>
                  <Camera className="h-4 w-4 mr-2" />
                  Start Camera
                </Button>
                
                <Button 
                  variant="outline" 
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Image
                </Button>
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          )}
          
          {isScanning && (
            <div className="space-y-4">
              <div className="relative">
                <video 
                  ref={videoRef} 
                  className="w-full rounded-lg"
                  autoPlay 
                  playsInline 
                />
                <div className="absolute inset-0 border-2 border-primary rounded-lg pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                                  w-48 h-48 border-2 border-primary bg-transparent">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary"></div>
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary"></div>
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary"></div>
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary"></div>
                  </div>
                </div>
              </div>
              
              <canvas ref={canvasRef} className="hidden" />
              
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Position the QR code within the frame
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setIsScanning(false);
                    stopCamera();
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Stop Scanning
                </Button>
              </div>
            </div>
          )}
          
          {scannedCode && (
            <div className="text-center space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-semibold mb-2">QR Code Detected:</p>
                <p className="font-mono text-sm break-all">{scannedCode}</p>
              </div>
              
              <div className="flex gap-2 justify-center">
                <Button onClick={() => {
                  setScannedCode(null);
                  setIsScanning(true);
                }}>
                  Scan Another
                </Button>
                
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setScannedCode(null);
                    onOpenChange(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}