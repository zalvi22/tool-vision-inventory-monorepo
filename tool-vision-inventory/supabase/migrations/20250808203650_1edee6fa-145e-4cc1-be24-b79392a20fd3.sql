-- Create locations table first (referenced by other tables)
CREATE TABLE public.locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  qr_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bin', 'pegboard', 'drawer', 'shelf', 'hook', 'rack', 'cabinet')),
  parent_location_id UUID REFERENCES public.locations(id),
  capacity INTEGER,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create items table
CREATE TABLE public.items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  size_specs TEXT,
  quantity INTEGER DEFAULT 1,
  quantity_unit TEXT DEFAULT 'piece',
  photo_path TEXT,
  purchase_date DATE,
  purchase_price DECIMAL(10,2),
  notes TEXT,
  date_added TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create item_locations table (many-to-many relationship)
CREATE TABLE public.item_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  date_placed TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  date_removed TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(item_id, location_id)
);

-- Create usage_log table
CREATE TABLE public.usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  checked_out_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  checked_in_date TIMESTAMP WITH TIME ZONE,
  project TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_log ENABLE ROW LEVEL SECURITY;

-- Create public access policies (no authentication required)
CREATE POLICY "Public access to locations" ON public.locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to items" ON public.items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to item_locations" ON public.item_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to usage_log" ON public.usage_log FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX idx_items_category ON public.items(category);
CREATE INDEX idx_items_brand ON public.items(brand);
CREATE INDEX idx_locations_qr_code ON public.locations(qr_code);
CREATE INDEX idx_item_locations_item_id ON public.item_locations(item_id);
CREATE INDEX idx_item_locations_location_id ON public.item_locations(location_id);
CREATE INDEX idx_usage_log_item_id ON public.usage_log(item_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();