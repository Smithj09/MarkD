
-- Supabase Marketplace Schema - Inquiry Enhanced

-- 1. Core Tables
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

INSERT INTO categories (name) VALUES ('Electronics'), ('Fashion'), ('Home & Living'), ('Wellness'), ('Outdoor');

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES auth.users(id) NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  stock INTEGER DEFAULT 0,
  image TEXT,
  rating DECIMAL(3,1) DEFAULT 5.0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Inquiries Table (The 'Send to Admin' feature)
CREATE TABLE inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_contact TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'NEW', -- NEW, REVIEWED, CONTACTED, CLOSED
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inquiry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES inquiries(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL
);

-- 3. RLS Policies
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiry_items ENABLE ROW LEVEL SECURITY;

-- Product Policies
CREATE POLICY "Anyone can view active products" ON products FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Vendors can manage their own products" ON products FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Admins can manage all products" ON products FOR ALL USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN');

-- Inquiry Policies
CREATE POLICY "Users can create inquiries" ON inquiries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own inquiries" ON inquiries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all inquiries" ON inquiries FOR SELECT USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN');
CREATE POLICY "Admins can update inquiries" ON inquiries FOR UPDATE USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN');

CREATE POLICY "Users can insert inquiry items" ON inquiry_items FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM inquiries WHERE id = inquiry_id AND user_id = auth.uid()));
CREATE POLICY "Admins can view all inquiry items" ON inquiry_items FOR SELECT USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'ADMIN');
