
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { GoogleGenAI } from "@google/genai";

// Initialize Express
const app = express();
const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'omni-market-secret-2025-prod';

// Initialize Gemini
// Fix: Use process.env.API_KEY directly as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Database Configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Security Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiting: 100 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." }
});
app.use('/api/', apiLimiter);

// --- AUTH MIDDLEWARE ---

// Fix: Extending express.Request with generics to avoid shadowing and ensure common properties like headers and body are correctly typed.
interface AuthRequest extends Request<any, any, any, any> {
  user?: {
    id: string;
    role: string;
  };
}

const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Fix: Property 'headers' is now correctly inherited from the base Request type via AuthRequest.
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Authentication token required' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const authorizeRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
};

// --- AUTHENTICATION ROUTES ---

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password, fullName, role } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, role',
      [email, hashedPassword, fullName, role || 'CUSTOMER']
    );

    // If vendor, create vendor profile
    if (role === 'VENDOR') {
      await pool.query('INSERT INTO vendors (user_id, store_name) VALUES ($1, $2)', [result.rows[0].id, `${fullName}'s Store`]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.rows[0].id, role: user.rows[0].role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.rows[0].id,
        name: user.rows[0].full_name,
        email: user.rows[0].email,
        role: user.rows[0].role
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- MARKETPLACE ROUTES ---

app.get('/api/products', async (req: Request, res: Response) => {
  const { category, search, limit = 50, offset = 0 } = req.query;
  try {
    let query = 'SELECT p.*, v.store_name FROM products p JOIN vendors v ON p.vendor_id = v.id WHERE p.is_active = TRUE';
    const params: any[] = [];

    if (category) {
      params.push(category);
      query += ` AND p.category_id = (SELECT id FROM categories WHERE name = $${params.length})`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    query += ` ORDER BY p.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}`;
    const results = await pool.query(query, params);
    res.json(results.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT p.*, v.store_name FROM products p JOIN vendors v ON p.vendor_id = v.id WHERE p.id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// --- ORDER & CHECKOUT ---

app.post('/api/orders', authenticateToken, async (req: AuthRequest, res: Response) => {
  // Fix: Property 'body' is now correctly inherited from the base Request type via AuthRequest.
  const { cartItems, shippingAddress } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    let total = 0;
    for (const item of cartItems) {
      const p = await client.query('SELECT price, stock_quantity FROM products WHERE id = $1', [item.productId]);
      if (p.rows[0].stock_quantity < item.quantity) throw new Error(`Insufficient stock for product ${item.productId}`);
      total += p.rows[0].price * item.quantity;
    }

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total_amount, shipping_address, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user!.id, total, shippingAddress, 'PAID']
    );

    for (const item of cartItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, (SELECT price FROM products WHERE id = $2))',
        [orderResult.rows[0].id, item.productId, item.quantity]
      );
      await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, item.productId]);
    }

    await client.query('COMMIT');
    res.status(201).json({ orderId: orderResult.rows[0].id, total });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- VENDOR DASHBOARD ROUTES ---

app.get('/api/vendor/stats', authenticateToken, authorizeRole(['VENDOR']), async (req: AuthRequest, res: Response) => {
  try {
    const vendor = await pool.query('SELECT id FROM vendors WHERE user_id = $1', [req.user!.id]);
    const vendorId = vendor.rows[0].id;

    const sales = await pool.query(
      'SELECT SUM(oi.quantity * oi.unit_price) as total_revenue, COUNT(DISTINCT oi.order_id) as total_orders FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE p.vendor_id = $1',
      [vendorId]
    );

    const weeklySales = await pool.query(
      `SELECT TO_CHAR(o.created_at, 'Dy') as day, SUM(oi.quantity * oi.unit_price) as sales 
       FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id 
       WHERE p.vendor_id = $1 AND o.created_at > NOW() - INTERVAL '7 days' 
       GROUP BY day, o.created_at ORDER BY o.created_at`,
      [vendorId]
    );

    res.json({
      summary: sales.rows[0],
      chartData: weeklySales.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vendor stats' });
  }
});

app.post('/api/vendor/products', authenticateToken, authorizeRole(['VENDOR']), async (req: AuthRequest, res: Response) => {
  // Fix: Property 'body' is now correctly inherited from the base Request type via AuthRequest.
  const { name, description, price, categoryId, stock, images } = req.body;
  try {
    const vendor = await pool.query('SELECT id FROM vendors WHERE user_id = $1', [req.user!.id]);
    const result = await pool.query(
      'INSERT INTO products (vendor_id, category_id, name, description, price, stock_quantity, image_urls) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [vendor.rows[0].id, categoryId, name, description, price, stock, images]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Product creation failed' });
  }
});

// --- ADMIN ROUTES ---

app.get('/api/admin/users', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const results = await pool.query('SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at DESC');
    res.json(results.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// --- AI ENRICHMENT ---

app.post('/api/ai/describe', authenticateToken, authorizeRole(['VENDOR', 'ADMIN']), async (req: Request, res: Response) => {
  const { productName, category } = req.body;
  try {
    // Generate AI content using the Gemini model.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a short, high-conversion product description for: ${productName} in the ${category} category. Limit to 40 words.`,
    });
    // Correctly accessing the text property from GenerateContentResponse as per SDK guidelines.
    res.json({ description: response.text });
  } catch (err) {
    res.status(500).json({ error: 'AI generation failed' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Production Backend Running at http://localhost:${port}`);
});
