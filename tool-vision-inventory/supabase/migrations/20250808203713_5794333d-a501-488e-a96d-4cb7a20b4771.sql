-- Enable RLS on existing tables that were missing it
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Create public access policies for existing tables (since no auth required)
CREATE POLICY "Public access to User" ON public."User" FOR ALL USING (true) WITH CHECK (true);

-- The customers, invoices, and payments tables already have some policies, 
-- but let's add DELETE policies to complete the access
CREATE POLICY "Public delete customers" ON public.customers FOR DELETE USING (true);
CREATE POLICY "Public update customers" ON public.customers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete invoices" ON public.invoices FOR DELETE USING (true);
CREATE POLICY "Public delete payments" ON public.payments FOR DELETE USING (true);