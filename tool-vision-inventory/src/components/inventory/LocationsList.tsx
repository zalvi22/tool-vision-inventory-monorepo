import { useState, useEffect } from "react";
import { Plus, MapPin, QrCode, Edit, Trash2, Printer, Settings, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoPrintLabel, setupPrinter, isPrintingSupported, printerService, testPrint } from "./PrinterService";
import { previewBinLabel, prepareBinLabel } from "@/lib/brotherWeb";

interface Location {
  id: string;
  qr_code: string;
  name: string;
  type: string;
  parent_location_id?: string;
  capacity?: number;
  description?: string;
  created_at: string;
}

export function LocationsList() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    parent_location_id: "",
    capacity: "",
    description: ""
  });
  const { toast } = useToast();

  const locationTypes = [
    "bin", "pegboard", "drawer", "shelf", "hook", "rack", "cabinet"
  ];

  useEffect(() => {
    fetchLocations();
    setPrinterConnected(printerService.isConnected);
  }, []);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch locations",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const generateQRCode = () => {
    return `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data, error } = await supabase
        .from('locations')
        .insert([{
          ...formData,
          qr_code: generateQRCode(),
          capacity: formData.capacity ? parseInt(formData.capacity) : null,
          parent_location_id: formData.parent_location_id === "none" ? null : formData.parent_location_id || null
        }])
        .select()
        .single();

      if (error) throw error;

      setLocations([data, ...locations]);
      
      // Auto-print label if enabled and printer is available
      if (autoPrintEnabled && isPrintingSupported()) {
        try {
          let currentStatus = "Preparing to print...";
          
          // Show initial toast with status
          const { dismiss } = toast({
            title: "Location Added!",
            description: currentStatus,
            duration: 10000, // Keep it visible during printing
          });

          const printResult = await autoPrintLabel(data.id, (status) => {
            currentStatus = status;
            dismiss(); // Remove previous toast
            toast({
              title: "Location Added!",
              description: status,
              duration: status === 'Print complete!' ? 3000 : 10000,
            });
          });
          
          dismiss(); // Remove any remaining toast
          
          if (printResult.success) {
            toast({
              title: "Success!",
              description: printResult.message,
            });
          } else {
            toast({
              title: "Location Added",
              description: `Location created successfully. Print failed: ${printResult.message}`,
              variant: "destructive"
            });
          }
        } catch (printError) {
          console.error('Auto-print error:', printError);
          toast({
            title: "Location Added",
            description: "Location created but auto-printing failed. Please print manually.",
            variant: "destructive"
          });
        }
      } else {
        toast({
          title: "Location Added",
          description: "Location created successfully!",
        });
      }

      setFormData({
        name: "",
        type: "",
        parent_location_id: "",
        capacity: "",
        description: ""
      });
      setShowAddDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add location",
        variant: "destructive"
      });
    }
  };

  const deleteLocation = async (id: string) => {
    try {
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setLocations(locations.filter(loc => loc.id !== id));
      toast({
        title: "Success",
        description: "Location deleted successfully"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete location",
        variant: "destructive"
      });
    }
  };

  const handleSetupPrinter = async () => {
    const connected = await setupPrinter();
    setPrinterConnected(connected);
    
    if (connected) {
      toast({
        title: "Printer Connected",
        description: "Brother QL-800 connected successfully! Labels will now auto-print.",
      });
    } else {
      toast({
        title: "Connection Failed",
        description: "Could not connect to Brother QL-800. Please check USB connection.",
        variant: "destructive"
      });
    }
  };

  const handleTestPrint = async () => {
    const result = await testPrint();
    
    if (result.success) {
      toast({
        title: "Test Print Sent",
        description: result.message,
      });
    } else {
      toast({
        title: "Test Print Failed",
        description: result.message,
        variant: "destructive"
      });
    }
  };

  const handlePreviewBin = async (loc: Location) => {
    const s = printerService.settings;
    const text = `${s.presets.bin.prefix} ${loc.name}`;
    const code = loc.qr_code || `BIN-${loc.id}`;
    const res = await previewBinLabel(text, code, {
      text,
      labelSize: s.labelSize,
      fontSize: s.fontSize,
      align: s.align,
      orientation: s.orientation,
      marginTop: s.margins.top,
      marginBottom: s.margins.bottom,
      marginLeft: s.margins.left,
      marginRight: s.margins.right,
      // slightly reduce to leave more room for text
      qr_scale: 0.9,
      // bins should auto-fit text height
      auto_fit_text: true as any,
    });
    if (res.ok && res.dataUrl) {
      const w = window.open('', '_blank');
      if (w) w.document.write(`<img src="${res.dataUrl}" style="max-width:100%" />`);
    } else {
      toast({ title: 'Preview failed', description: res.error || 'Could not preview bin label', variant: 'destructive' });
    }
  };

  const handlePrintBin = async (loc: Location) => {
    try {
      if (!printerService.isConnected) {
        const ok = await printerService.connect();
        if (!ok) {
          toast({ title: 'Printer', description: 'Failed to connect to printer', variant: 'destructive' });
          return;
        }
      }
      const s = printerService.settings;
      const text = `${s.presets.bin.prefix} ${loc.name}`;
      const code = s.presets.bin.includeQr ? (loc.qr_code || `BIN-${loc.id}`) : '';
      // Ensure barcode (QR) is fully generated server-side before preparing raster
      const preview = await previewBinLabel(text, code, {
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
        auto_fit_text: true as any,
      });
      if (!preview.ok) {
        toast({ title: 'Preview failed', description: preview.error || 'Could not render QR', variant: 'destructive' });
        return;
      }
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
        auto_fit_text: true as any,
      });
      if (!prep.ok || !prep.data) {
        toast({ title: 'Print error', description: prep.error || 'Failed to prepare bin label', variant: 'destructive' });
        return;
      }
      const ok = await printerService.print(Array.from(prep.data));
      if (ok) toast({ title: 'Printed', description: `Bin label printed for ${loc.name}` });
      else toast({ title: 'Printer', description: 'Failed to send bin label', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Print failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const getParentLocationName = (parentId?: string) => {
    if (!parentId) return null;
    const parent = locations.find(loc => loc.id === parentId);
    return parent?.name;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <MapPin className="h-8 w-8 animate-pulse text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Locations ({locations.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Organize your workspace with QR-coded locations
            </p>
          </div>
          <div className="flex gap-2">
            {isPrintingSupported() && (
              <>
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={handleSetupPrinter}
                  className={printerConnected ? "bg-success/10 border-success text-success" : ""}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {printerConnected ? "Printer Ready" : "Setup Printer"}
                </Button>
                {printerConnected && (
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={handleTestPrint}
                  >
                    <TestTube className="h-4 w-4 mr-2" />
                    Test Print
                  </Button>
                )}
              </>
            )}
            <Button 
              onClick={() => setShowAddDialog(true)}
              className="shadow-soft"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          </div>
        </div>

        {locations.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
              <MapPin className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No locations yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Create your first location to start organizing your tools with QR codes for easy tracking.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations.map(location => (
              <Card key={location.id} className="group hover:shadow-soft transition-all duration-200 border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground text-lg mb-1">{location.name}</h3>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground bg-muted/50 rounded-md px-2 py-1 w-fit">
                        <QrCode className="h-3 w-3" />
                        <span className="font-mono text-xs">{location.qr_code}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => deleteLocation(location.id)}
                        className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      {isPrintingSupported() && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Preview Bin Label" onClick={() => handlePreviewBin(location)}>P</Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Print Bin Label" onClick={() => handlePrintBin(location)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <Badge 
                    variant="outline" 
                    className="mb-3 capitalize bg-accent/10 text-accent border-accent/20"
                  >
                    {location.type}
                  </Badge>
                  
                  {location.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                      {location.description}
                    </p>
                  )}
                  
                  <div className="space-y-2">
                    {getParentLocationName(location.parent_location_id) && (
                      <div className="text-xs text-muted-foreground">
                        Parent: <span className="font-medium">{getParentLocationName(location.parent_location_id)}</span>
                      </div>
                    )}
                    
                    {location.capacity && (
                      <div className="text-xs text-muted-foreground">
                        Capacity: <span className="font-medium">{location.capacity} items</span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Items stored:</span>
                      <Badge variant="secondary" className="text-xs bg-success/10 text-success border-success/20">
                        0 items
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Location</DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Location Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Workshop - East Wall - Pegboard 1"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select 
                value={formData.type} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location type" />
                </SelectTrigger>
                <SelectContent>
                  {locationTypes.map(type => (
                    <SelectItem key={type} value={type} className="capitalize">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="parent">Parent Location</Label>
              <Select 
                value={formData.parent_location_id || "none"} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, parent_location_id: value === "none" ? "" : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select parent location (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                type="number"
                min="1"
                value={formData.capacity}
                onChange={(e) => setFormData(prev => ({ ...prev, capacity: e.target.value }))}
                placeholder="Maximum number of items"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Additional details about this location..."
              />
            </div>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!formData.name || !formData.type}>
                Add Location
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
