import { useState } from "react";
import { Plus, Package, MapPin, BarChart3, Search, Wrench, AlertTriangle, TrendingUp, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AddItemDialog } from "@/components/inventory/AddItemDialog";
import { ItemsList } from "@/components/inventory/ItemsList";
import { LocationsList } from "@/components/inventory/LocationsList";
import { QRScanner } from "@/components/inventory/QRScanner";
import { PrintSettingsDialog } from "@/components/inventory/PrintSettingsDialog";

const Index = () => {
  const [showAddItem, setShowAddItem] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showPrintSettings, setShowPrintSettings] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header with gradient background */}
      <header className="gradient-bg border-b shadow-elegant">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Wrench className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Tool Inventory</h1>
                <p className="text-white/80 text-sm">Comprehensive tool management system</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <Button 
                variant="outline" 
                size="default"
                onClick={() => setShowPrintSettings(true)}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 backdrop-blur-sm"
              >
                <Settings className="h-4 w-4 mr-2" />
                Print Settings
              </Button>
              <Button 
                variant="outline" 
                size="default"
                onClick={() => setShowQRScanner(true)}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 backdrop-blur-sm"
              >
                <Search className="h-4 w-4 mr-2" />
                Scan QR Code
              </Button>
              <Button 
                size="default"
                onClick={() => setShowAddItem(true)}
                className="bg-white text-primary hover:bg-white/90 font-semibold shadow-soft"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Item
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border-0 shadow-soft bg-gradient-to-br from-primary/5 to-primary/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-primary">Total Items</CardTitle>
              <div className="p-2 bg-primary/10 rounded-full">
                <Package className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-success font-medium">+0</span> from last month
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-0 shadow-soft bg-gradient-to-br from-accent/5 to-accent/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-accent">Locations</CardTitle>
              <div className="p-2 bg-accent/10 rounded-full">
                <MapPin className="h-4 w-4 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-accent">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-success font-medium">+0</span> new this week
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-0 shadow-soft bg-gradient-to-br from-info/5 to-info/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-info">Categories</CardTitle>
              <div className="p-2 bg-info/10 rounded-full">
                <BarChart3 className="h-4 w-4 text-info" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-info">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                <TrendingUp className="h-3 w-3 inline mr-1 text-success" />
                Well organized
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-0 shadow-soft bg-gradient-to-br from-warning/5 to-warning/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-warning">Low Stock</CardTitle>
              <div className="p-2 bg-warning/10 rounded-full">
                <AlertTriangle className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-warning">0</div>
              <Badge variant="outline" className="text-xs mt-1 border-warning/20 text-warning">
                No alerts
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Card className="border-0 shadow-soft">
          <Tabs defaultValue="items" className="w-full">
            <div className="border-b bg-muted/30">
              <TabsList className="grid w-full grid-cols-3 h-12 bg-transparent">
                <TabsTrigger 
                  value="items" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                >
                  <Package className="h-4 w-4 mr-2" />
                  Items
                </TabsTrigger>
                <TabsTrigger 
                  value="locations"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  Locations
                </TabsTrigger>
                <TabsTrigger 
                  value="analytics"
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analytics
                </TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="items" className="m-0">
              <ItemsList />
            </TabsContent>
            
            <TabsContent value="locations" className="m-0">
              <LocationsList />
            </TabsContent>
            
            <TabsContent value="analytics" className="m-0">
              <div className="p-6">
                <div className="text-center py-12">
                  <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
                    <BarChart3 className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Analytics Dashboard</h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Comprehensive usage analytics, inventory trends, and detailed reports will be available here once you start adding items and tracking usage.
                  </p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={() => setShowAddItem(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Item
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </main>

      <AddItemDialog 
        open={showAddItem} 
        onOpenChange={setShowAddItem} 
      />
      
      <QRScanner 
        open={showQRScanner} 
        onOpenChange={setShowQRScanner} 
      />
      <PrintSettingsDialog open={showPrintSettings} onOpenChange={setShowPrintSettings} />
    </div>
  );
};

export default Index;
