'use strict';

const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const path         = require('path');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const multer       = require('multer');
const { v4: uuid } = require('uuid');
const fs           = require('fs');
const { Pool }     = require('pg');

const JWT_SECRET   = process.env.JWT_SECRET   || 'kalachautari-secret-2025';
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'kalachautari-admin-2025';
const PORT         = process.env.PORT          || 3000;
const DATABASE_URL = process.env.DATABASE_URL  || 'postgresql://postgres:sSRGdJBuebshjDneGNfaOcHzGJDxdFoH@postgres.railway.internal:5432/railway';
const UPLOAD_DIR   = path.join(__dirname, '../uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── PostgreSQL Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
});

async function db(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

async function dbOne(sql, params = []) {
  const r = await db(sql, params);
  return r.rows[0] || null;
}

async function dbAll(sql, params = []) {
  const r = await db(sql, params);
  return r.rows;
}

// ─── Schema Setup ─────────────────────────────────────────────────────────────
async function setupSchema() {
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, name_np TEXT DEFAULT '',
      email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT DEFAULT '', bio TEXT DEFAULT '', bio_np TEXT DEFAULT '',
      location TEXT DEFAULT '', disciplines JSONB DEFAULT '[]',
      skills JSONB DEFAULT '[]', genres JSONB DEFAULT '[]',
      avatar_init TEXT DEFAULT '', avatar_color TEXT DEFAULT 'rust',
      open_to_remote INTEGER DEFAULT 1, experience_years INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
      title_np TEXT DEFAULT '', type TEXT NOT NULL,
      description TEXT DEFAULT '', description_np TEXT DEFAULT '',
      roles_needed JSONB DEFAULT '[]', timeline TEXT DEFAULT '',
      location TEXT DEFAULT '', remote_ok INTEGER DEFAULT 1,
      experience_req TEXT DEFAULT 'Any', max_collaborators INTEGER DEFAULT 5,
      status TEXT DEFAULT 'open', media_links JSONB DEFAULT '[]',
      cover_url TEXT DEFAULT '', view_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS interests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role_offer TEXT DEFAULT '', message TEXT DEFAULT '',
      portfolio_link TEXT DEFAULT '', status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL,
      type TEXT DEFAULT 'connect', status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_a, user_b)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, type TEXT DEFAULT 'direct',
      project_id TEXT DEFAULT NULL, name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conv_members (
      conv_id TEXT NOT NULL, user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(conv_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conv_id TEXT NOT NULL,
      sender_id TEXT DEFAULT NULL, type TEXT DEFAULT 'text',
      content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, creator_id TEXT DEFAULT NULL,
      title TEXT NOT NULL, title_np TEXT DEFAULT '',
      description TEXT DEFAULT '', location TEXT DEFAULT '',
      event_date TEXT NOT NULL, event_time TEXT DEFAULT '',
      is_online INTEGER DEFAULT 0, is_free INTEGER DEFAULT 1,
      ticket_tiers JSONB DEFAULT '[]', tags JSONB DEFAULT '[]',
      cover_url TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rsvps (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
      tier TEXT DEFAULT 'general', qty INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
      type TEXT NOT NULL, description TEXT DEFAULT '',
      file_url TEXT DEFAULT '', external_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '',
      read INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Schema ready');
}

async function seedDemo() {
  const count = await dbOne('SELECT COUNT(*) as c FROM users');
  if (parseInt(count.c) > 0) return;
  console.log('Seeding demo data...');
  const hash = bcrypt.hashSync('demo1234', 10);
  const users = [
    ['u1','Aasha Gurung','आशा गुरुङ','aasha@demo.com',hash,'Singer · Songwriter','Folk-influenced indie artist from Pokhara.','Pokhara','["musician"]','["Vocals","Songwriting","Production"]','["Folk Fusion","Indie Pop"]','आ','rust',7],
    ['u2','Bikash Magar','बिकाश मगर','bikash@demo.com',hash,'Filmmaker · Director','Documentary filmmaker. 5 films, 3 intl festivals.','Kathmandu','["filmmaker"]','["Direction","Cinematography"]','["Documentary","Short Film"]','बि','blue',7],
    ['u3','Mira Thapa','मीरा थापा','mira@demo.com',hash,'Poet · Writer','Writing in Nepali and English. 3 anthologies.','London, UK','["writer"]','["Poetry","Short Fiction"]','["Poetry","Literary Fiction"]','मी','gold',6],
    ['u4','Sujen Rai','सुजन राई','sujen@demo.com',hash,'Guitarist · Producer','Folk fusion and indie rock. Remote welcome.','Sydney, AU','["musician"]','["Guitar","Production","Mixing"]','["Folk Fusion","Indie Rock"]','सु','rust',10],
    ['u5','Anita Lama','अनिता लामा','anita@demo.com',hash,'Illustrator','Thangka-inspired illustration.','Pokhara','["visual"]','["Illustration","Design"]','["Visual Art"]','अ','green',5],
    ['u6','Roshan Tamang','रोशन तामाङ','roshan@demo.com',hash,'Screenwriter · Director','Short film specialist.','Paris, FR','["filmmaker"]','["Screenwriting","Direction"]','["Short Film","Drama"]','रो','blue',6],
  ];
  for (const u of users) {
    await db(`INSERT INTO users (id,name,name_np,email,password,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, u);
  }
  const projects = [
    ['p1','u1','Himalaya EP','हिमालय EP','Music','6-track folk fusion EP. Remote welcome.','नेपाली लोक धुनसँग इन्डी EP।','["Tabla Player","Videographer","Mixing Engineer"]','3-6 months','Pokhara',1],
    ['p2','u6','Bato — Short Film','बाटो — छोटो फिल्म','Film','20-min narrative short about migration.','प्रवासबारे छोटो फिल्म।','["Cinematographer","Sound Designer","Lead Actor"]','1-3 months','Kathmandu',0],
    ['p3','u3','Kavita Sangrah','कविता संग्रह','Literature','Bilingual poetry collection.','द्विभाषी कविता संग्रह।','["Illustrator","Book Designer"]','1-3 months','Remote',1],
    ['p4','u5','Thangka Meets Beat','थाङ्का मिट्स बिट','Visual Art','Thangka art + electronic music.','थाङ्का कला र इलेक्ट्रोनिक संगीत।','["Electronic Producer","Animator"]','Ongoing','Remote',1],
  ];
  for (const p of projects) {
    await db(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`, p);
  }
  const events = [
    ['e1','u1','Kala Saanjh — Open Mic','कला साँझ — ओपन माइक','Monthly open mic','Patan Dhoka, Lalitpur','2026-03-22','17:00',0,1,'["Music","Poetry","Free"]','[{"name":"General","price":0,"desc":"Open floor"},{"name":"Supporter","price":500,"desc":"Reserved seat"}]'],
    ['e2','u2','Diaspora Creatives Meetup','डायस्पोरा भेट','Networking for Nepali creatives','Nepal Centre, London','2026-04-05','15:00',0,0,'["Networking","All Arts"]','[{"name":"General","price":0,"desc":"Walk-in"},{"name":"VIP","price":1500,"desc":"Dinner included"}]'],
    ['e3','u6','Short Film Workshop','लघु फिल्म कार्यशाला','Online cinematography masterclass','Online (Zoom)','2026-04-18','18:00',1,0,'["Film","Workshop"]','[{"name":"Early Bird","price":500,"desc":"Limited"},{"name":"Standard","price":800,"desc":"Full access"}]'],
  ];
  for (const e of events) {
    await db(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,tags,ticket_tiers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`, e);
  }
  await db(`INSERT INTO conversations (id,type,project_id,name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, ['c1','group','p1','Himalaya EP — Team']);
  for (const uid of ['u1','u2','u4']) {
    await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ['c1',uid]);
  }
  await db(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [uuid(),'c1',null,'system','Group created: Himalaya EP Collaboration']);
  console.log('Demo seeded. Login: aasha@demo.com / demo1234');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function optAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h) { try { req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET); } catch {} }
  next();
}
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 100 * 1024 * 1024 } });
const wsClients = new Map();

async function pushNotif(userId, type, title, body='', link='') {
  await db(`INSERT INTO notifications (id,user_id,type,title,body,link) VALUES ($1,$2,$3,$4,$5,$6)`, [uuid(),userId,type,title,body,link]);
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event:'notification', data:{type,title,body,link} }));
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, location, disciplines } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:'Missing fields' });
  if (await dbOne('SELECT id FROM users WHERE email=$1', [email])) return res.status(409).json({ error:'Email already registered' });
  const id = uuid(), hash = bcrypt.hashSync(password, 10);
  const colors = ['rust','blue','gold','green'];
  const color = colors[Math.floor(Math.random()*4)];
  await db(`INSERT INTO users (id,name,email,password,role,location,disciplines,avatar_init,avatar_color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, name, email, hash, role||'', location||'', JSON.stringify(disciplines||[]), name.charAt(0).toUpperCase(), color]);
  const token = jwt.sign({id,name,email}, JWT_SECRET, {expiresIn:'30d'});
  const user = await dbOne('SELECT id,name,name_np,email,role,bio,bio_np,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=$1', [id]);
  res.json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await dbOne('SELECT * FROM users WHERE email=$1', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error:'Invalid credentials' });
  const token = jwt.sign({id:user.id, name:user.name, email:user.email}, JWT_SECRET, {expiresIn:'30d'});
  const safe = {...user}; delete safe.password;
  res.json({ token, user: safe });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', optAuth, async (req, res) => {
  const { type, search } = req.query;
  let sql = `SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE 1=1`;
  const params = [];
  if (type) { params.push(`%${type}%`); sql += ` AND disciplines::text ILIKE $${params.length}`; }
  if (search) {
    params.push(`%${search}%`); const si = params.length;
    params.push(`%${search}%`); const si2 = params.length;
    params.push(`%${search}%`); const si3 = params.length;
    sql += ` AND (name ILIKE $${si} OR role ILIKE $${si2} OR skills::text ILIKE $${si3})`;
  }
  sql += ` ORDER BY created_at DESC`;
  res.json(await dbAll(sql, params));
});

app.get('/api/users/:id', async (req, res) => {
  const u = await dbOne('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE id=$1', [req.params.id]);
  if (!u) return res.status(404).json({ error:'Not found' });
  u.projects  = await dbAll('SELECT id,title,type,status FROM projects WHERE owner_id=$1 AND status=$2', [req.params.id,'open']);
  u.portfolio = await dbAll('SELECT * FROM portfolio_items WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(u);
});

app.patch('/api/users/me', auth, async (req, res) => {
  const { name, name_np, role, bio, bio_np, location, disciplines, skills, genres, experience_years, open_to_remote } = req.body;
  await db(`UPDATE users SET name=COALESCE($1,name),name_np=COALESCE($2,name_np),role=COALESCE($3,role),bio=COALESCE($4,bio),bio_np=COALESCE($5,bio_np),location=COALESCE($6,location),disciplines=COALESCE($7::jsonb,disciplines),skills=COALESCE($8::jsonb,skills),genres=COALESCE($9::jsonb,genres),experience_years=COALESCE($10,experience_years),open_to_remote=COALESCE($11,open_to_remote) WHERE id=$12`,
    [name||null,name_np||null,role||null,bio||null,bio_np||null,location||null,disciplines?JSON.stringify(disciplines):null,skills?JSON.stringify(skills):null,genres?JSON.stringify(genres):null,experience_years||null,open_to_remote!==undefined?(open_to_remote?1:0):null,req.user.id]);
  res.json(await dbOne('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=$1', [req.user.id]));
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', optAuth, async (req, res) => {
  const { type, remote, search, status } = req.query;
  let sql = `SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); sql += ` AND p.status=$${params.length}`; } else sql += ` AND p.status='open'`;
  if (type) { params.push(type); sql += ` AND p.type=$${params.length}`; }
  if (remote==='1') sql += ` AND p.remote_ok=1`;
  if (search) {
    params.push(`%${search}%`); const ps1 = params.length;
    params.push(`%${search}%`); const ps2 = params.length;
    sql += ` AND (p.title ILIKE $${ps1} OR p.description ILIKE $${ps2})`;
  }
  sql += ` ORDER BY p.created_at DESC`;
  res.json(await dbAll(sql, params));
});

app.get('/api/projects/:id', optAuth, async (req, res) => {
  const p = await dbOne(`SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=$1`, [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  await db(`UPDATE projects SET view_count=view_count+1 WHERE id=$1`, [req.params.id]);
  if (req.user) p.my_interest = await dbOne('SELECT * FROM interests WHERE project_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json(p);
});

app.post('/api/projects', auth, async (req, res) => {
  const { title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  await db(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id,req.user.id,title,title_np||'',type,description||'',description_np||'',JSON.stringify(roles_needed||[]),timeline||'',location||'',remote_ok?1:0,experience_req||'Any',max_collaborators||5,JSON.stringify(media_links||[]),cover_url||'']);
  res.status(201).json(await dbOne('SELECT p.*,u.name as owner_name,u.avatar_init as owner_init FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=$1', [id]));
});

app.patch('/api/projects/:id', auth, async (req, res) => {
  const p = await dbOne('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { title,description,status,roles_needed } = req.body;
  await db(`UPDATE projects SET title=COALESCE($1,title),description=COALESCE($2,description),status=COALESCE($3,status),roles_needed=COALESCE($4,roles_needed) WHERE id=$5`,
    [title,description,status,roles_needed?JSON.stringify(roles_needed):null,req.params.id]);
  res.json(await dbOne('SELECT * FROM projects WHERE id=$1', [req.params.id]));
});

// ─── INTERESTS ────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/interests', auth, async (req, res) => {
  const p = await dbOne('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  res.json(await dbAll(`SELECT i.*,u.name,u.name_np,u.role,u.avatar_init,u.avatar_color,u.location,u.skills FROM interests i JOIN users u ON i.user_id=u.id WHERE i.project_id=$1 ORDER BY i.created_at DESC`, [req.params.id]));
});

app.post('/api/projects/:id/interest', auth, async (req, res) => {
  const project = await dbOne('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!project) return res.status(404).json({ error:'Project not found' });
  if (project.owner_id===req.user.id) return res.status(400).json({ error:'Cannot express interest in your own project' });
  if (await dbOne('SELECT id FROM interests WHERE project_id=$1 AND user_id=$2', [req.params.id, req.user.id])) return res.status(409).json({ error:'Already expressed interest' });
  const { role_offer, message, portfolio_link } = req.body;
  const id = uuid();
  await db(`INSERT INTO interests (id,project_id,user_id,role_offer,message,portfolio_link) VALUES ($1,$2,$3,$4,$5,$6)`, [id,req.params.id,req.user.id,role_offer||'',message||'',portfolio_link||'']);
  const iUser = await dbOne('SELECT name FROM users WHERE id=$1', [req.user.id]);
  await pushNotif(project.owner_id, 'interest', `New interest in "${project.title}"`, `${iUser.name} wants to collaborate as: ${role_offer||'collaborator'}`, `/projects/${req.params.id}`);
  const ownerWs = wsClients.get(project.owner_id);
  if (ownerWs && ownerWs.readyState===WebSocket.OPEN)
    ownerWs.send(JSON.stringify({ event:'new_interest', data:{project_id:req.params.id,project_title:project.title,user_name:iUser.name,role_offer} }));
  res.status(201).json({ id, status:'pending' });
});

app.patch('/api/interests/:id', auth, async (req, res) => {
  const interest = await dbOne(`SELECT i.*,p.owner_id,p.title as project_title FROM interests i JOIN projects p ON i.project_id=p.id WHERE i.id=$1`, [req.params.id]);
  if (!interest) return res.status(404).json({ error:'Not found' });
  if (interest.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { status } = req.body;
  await db(`UPDATE interests SET status=$1 WHERE id=$2`, [status, req.params.id]);
  if (status==='accepted') {
    const convId = uuid();
    await db(`INSERT INTO conversations (id,type,project_id,name) VALUES ($1,$2,$3,$4)`, [convId,'direct',interest.project_id,'']);
    await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [convId,req.user.id]);
    await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [convId,interest.user_id]);
    await db(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES ($1,$2,$3,$4,$5)`, [uuid(),convId,null,'system',`Collaboration started on: ${interest.project_title}`]);
    await pushNotif(interest.user_id, 'accepted', 'Collaboration accepted!', `Your interest in "${interest.project_title}" was accepted.`, `/messages/${convId}`);
  } else if (status==='declined') {
    await pushNotif(interest.user_id, 'declined', 'Interest update', `Your interest in "${interest.project_title}" was reviewed.`);
  }
  res.json({ ok:true, status });
});

// ─── MATCHES ──────────────────────────────────────────────────────────────────
app.post('/api/matches', auth, async (req, res) => {
  const { target_id, type } = req.body;
  if (target_id===req.user.id) return res.status(400).json({ error:'Cannot match yourself' });
  if (await dbOne('SELECT id FROM matches WHERE user_a=$1 AND user_b=$2', [req.user.id,target_id])) return res.json({ matched:false, alreadyExists:true });
  await db(`INSERT INTO matches (id,user_a,user_b,type) VALUES ($1,$2,$3,$4)`, [uuid(),req.user.id,target_id,type||'connect']);
  const mutual = await dbOne(`SELECT id FROM matches WHERE user_a=$1 AND user_b=$2`, [target_id,req.user.id]);
  let convId = null;
  if (mutual) {
    await db(`UPDATE matches SET status='matched' WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)`, [req.user.id,target_id]);
    convId = uuid();
    await db(`INSERT INTO conversations (id,type,name) VALUES ($1,$2,$3)`, [convId,'direct','']);
    await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [convId,req.user.id]);
    await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [convId,target_id]);
    const me = await dbOne('SELECT name FROM users WHERE id=$1', [req.user.id]);
    await pushNotif(target_id, 'match', 'New Match!', `You and ${me.name} both want to connect!`, `/messages/${convId}`);
  }
  res.json({ matched:!!mutual, conv_id:convId });
});

app.get('/api/matches/suggestions', auth, async (req, res) => {
  const me = await dbOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const seen = await dbAll(`SELECT user_b as id FROM matches WHERE user_a=$1 UNION SELECT user_a as id FROM matches WHERE user_b=$1`, [req.user.id]);
  const seenIds = [...seen.map(r=>r.id), req.user.id];
  const placeholders = seenIds.map((_,i)=>`$${i+1}`).join(',');
  const candidates = await dbAll(`SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 20`, seenIds);
  const myGenres = me.genres || [];
  const myDisc = me.disciplines || [];
  const scored = candidates.map(u => {
    const theirG = u.genres || [];
    const theirD = u.disciplines || [];
    const overlap = theirG.filter(g=>myGenres.includes(g)).length;
    const diff = !myDisc.some(d=>theirD.includes(d));
    return { ...u, match_score: Math.min(99, 60+overlap*8+(diff?15:0)+(u.open_to_remote?5:0)+Math.floor(Math.random()*12)) };
  });
  res.json(scored.sort((a,b)=>b.match_score-a.match_score));
});

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────
app.get('/api/conversations', auth, async (req, res) => {
  const convs = await dbAll(`SELECT c.*,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg,(SELECT created_at FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count FROM conversations c JOIN conv_members cm ON c.id=cm.conv_id WHERE cm.user_id=$1 ORDER BY last_time DESC NULLS LAST`, [req.user.id]);
  for (const c of convs) {
    c.members = await dbAll(`SELECT u.id,u.name,u.avatar_init,u.avatar_color FROM conv_members cm JOIN users u ON cm.user_id=u.id WHERE cm.conv_id=$1`, [c.id]);
  }
  res.json(convs);
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  if (!await dbOne('SELECT conv_id FROM conv_members WHERE conv_id=$1 AND user_id=$2', [req.params.id,req.user.id])) return res.status(403).json({ error:'Not a member' });
  res.json(await dbAll(`SELECT m.*,u.name as sender_name,u.avatar_init as sender_init FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.conv_id=$1 ORDER BY m.created_at ASC`, [req.params.id]));
});

app.post('/api/conversations', auth, async (req, res) => {
  const { target_user_id, project_id } = req.body;
  if (target_user_id) {
    const ex = await dbOne(`SELECT c.id FROM conversations c JOIN conv_members a ON c.id=a.conv_id AND a.user_id=$1 JOIN conv_members b ON c.id=b.conv_id AND b.user_id=$2 WHERE c.type='direct'`, [req.user.id,target_user_id]);
    if (ex) return res.json({ id:ex.id });
  }
  const id = uuid();
  await db(`INSERT INTO conversations (id,type,project_id) VALUES ($1,$2,$3)`, [id,target_user_id?'direct':'group',project_id||null]);
  await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id,req.user.id]);
  if (target_user_id) await db(`INSERT INTO conv_members (conv_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id,target_user_id]);
  res.status(201).json({ id });
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  res.json(await dbAll(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`));
});

app.post('/api/events', auth, async (req, res) => {
  const { title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags } = req.body;
  if (!title||!event_date) return res.status(400).json({ error:'title and event_date required' });
  const id = uuid();
  await db(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id,req.user.id,title,title_np||'',description||'',location||'',event_date,event_time||'',is_online?1:0,is_free?1:0,JSON.stringify(ticket_tiers||[]),JSON.stringify(tags||[])]);
  res.status(201).json(await dbOne('SELECT * FROM events WHERE id=$1', [id]));
});

app.post('/api/events/:id/rsvp', auth, async (req, res) => {
  const ev = await dbOne('SELECT * FROM events WHERE id=$1', [req.params.id]);
  if (!ev) return res.status(404).json({ error:'Not found' });
  if (await dbOne('SELECT id FROM rsvps WHERE event_id=$1 AND user_id=$2', [req.params.id,req.user.id])) return res.status(409).json({ error:"Already RSVP'd" });
  const id = uuid();
  await db(`INSERT INTO rsvps (id,event_id,user_id,tier,qty) VALUES ($1,$2,$3,$4,$5)`, [id,req.params.id,req.user.id,req.body.tier||'general',req.body.qty||1]);
  await pushNotif(req.user.id, 'rsvp', `RSVP confirmed: ${ev.title}`, `You're attending on ${ev.event_date}`);
  res.status(201).json({ id });
});

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────
app.get('/api/users/:id/portfolio', async (req, res) => {
  res.json(await dbAll('SELECT * FROM portfolio_items WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]));
});
app.post('/api/portfolio', auth, async (req, res) => {
  const { title,type,description,file_url,external_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  await db(`INSERT INTO portfolio_items (id,user_id,title,type,description,file_url,external_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,req.user.id,title,type,description||'',file_url||'',external_url||'']);
  res.status(201).json(await dbOne('SELECT * FROM portfolio_items WHERE id=$1', [id]));
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  res.json(await dbAll('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]));
});
app.patch('/api/notifications/read', auth, async (req, res) => {
  await db('UPDATE notifications SET read=1 WHERE user_id=$1', [req.user.id]);
  res.json({ ok:true });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = `%${req.query.q||''}%`;
  res.json({
    users:    await dbAll('SELECT id,name,role,avatar_init,avatar_color FROM users WHERE name ILIKE $1 OR role ILIKE $1 LIMIT 5', [q]),
    projects: await dbAll("SELECT id,title,type FROM projects WHERE title ILIKE $1 AND status='open' LIMIT 5", [q]),
    events:   await dbAll('SELECT id,title,event_date FROM events WHERE title ILIKE $1 LIMIT 5', [q]),
  });
});

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'No file' });
  const newName = uuid() + path.extname(req.file.originalname);
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));
  res.json({ url:`/uploads/${newName}`, name:req.file.originalname, size:req.file.size });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/admin', adminAuth, (req, res) => {
  const key = req.query.key || ADMIN_SECRET;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Kalachautari Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&family=Yatra+One&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Mukta',sans-serif;background:#120A04;color:#F4ECD8;min-height:100vh}
nav{background:#0A0602;border-bottom:2px solid #C9922A;padding:0 2rem;height:56px;display:flex;align-items:center;gap:12px}
nav h1{font-family:'Yatra One',serif;color:#C9922A;font-size:1.25rem;margin-right:8px}
nav span{color:rgba(255,255,255,0.35);font-size:0.75rem}
.tabs{display:flex;background:#0F0804;border-bottom:1px solid rgba(255,255,255,0.07);padding:0 2rem;overflow-x:auto}
.tab{background:none;border:none;color:rgba(255,255,255,0.45);padding:13px 20px;cursor:pointer;font-family:'Mukta',sans-serif;font-size:0.83rem;border-bottom:2px solid transparent;white-space:nowrap;transition:all 0.15s}
.tab:hover{color:rgba(255,255,255,0.8)}
.tab.act{color:#C9922A;border-bottom-color:#C9922A;font-weight:700}
.pg{display:none;padding:2rem}
.pg.act{display:block}
.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem}
.stat{background:#1A0E06;border:1px solid rgba(201,146,42,0.2);border-radius:8px;padding:1.25rem;text-align:center}
.stat-n{font-family:'Yatra One',serif;font-size:2.2rem;color:#C9922A;line-height:1}
.stat-l{font-size:0.65rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:5px}
.sec{font-family:'Yatra One',serif;font-size:1.1rem;color:#C9922A;margin-bottom:1rem}
.srch{background:#1A0E06;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:7px 12px;color:#F4ECD8;font-family:'Mukta',sans-serif;font-size:0.82rem;width:280px;margin-bottom:1rem}
.srch:focus{outline:none;border-color:#C9922A}
table{width:100%;border-collapse:collapse;font-size:0.82rem}
th{text-align:left;padding:9px 12px;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.35);border-bottom:1px solid rgba(255,255,255,0.07);white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top}
tr:hover td{background:rgba(255,255,255,0.02)}
.badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:0.67rem;font-weight:700}
.open{background:#1A4D2A;color:#6FCF97}.pending{background:#412402;color:#F0B86A}
.accepted{background:#1A4D2A;color:#6FCF97}.closed{background:#4A1B0C;color:#F08070}
.declined{background:#3A1A1A;color:#F08080}
.btn{background:#B8432F;color:#fff;border:none;padding:4px 11px;border-radius:3px;cursor:pointer;font-size:0.72rem;font-weight:700;font-family:'Mukta',sans-serif}
.btn:hover{background:#8C2E1A}
.btn.d{background:rgba(180,40,40,0.3);color:#F08070}
.btn.d:hover{background:#7A1A1A;color:#fff}
.prev{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.5);font-size:0.75rem}
.email{color:#C9922A}
.empty{color:rgba(255,255,255,0.25);padding:2rem;text-align:center;font-size:0.85rem}
.err{color:#F08070;padding:1rem;font-size:0.85rem;background:rgba(180,40,40,0.1);border-radius:4px;margin-bottom:1rem}
#toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#C9922A;color:#1A0F08;padding:10px 16px;border-radius:5px;font-size:0.82rem;font-weight:700;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:100}
#toast.show{opacity:1}
.loading{color:rgba(255,255,255,0.3);padding:2rem;text-align:center}
</style>
</head>
<body>
<nav>
  <h1>कलाचौतारी Admin</h1>
  <span>Platform Management Dashboard</span>
</nav>
<div class="tabs">
  <button class="tab act" data-tab="dashboard" onclick="showTab('dashboard')">Dashboard</button>
  <button class="tab" data-tab="users" onclick="showTab('users')">Users</button>
  <button class="tab" data-tab="projects" onclick="showTab('projects')">Projects</button>
  <button class="tab" data-tab="interests" onclick="showTab('interests')">Interests</button>
  <button class="tab" data-tab="messages" onclick="showTab('messages')">Messages</button>
  <button class="tab" data-tab="events" onclick="showTab('events')">Events</button>
</div>

<div id="pg-dashboard" class="pg act">
  <div id="err-dashboard"></div>
  <div class="stat-row" id="stats">
    <div class="stat"><div class="stat-n">—</div><div class="stat-l">Loading...</div></div>
  </div>
  <div class="sec">Recent Signups</div>
  <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Joined</th></tr></thead>
  <tbody id="tb-recent"><tr><td colspan="5" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="pg-users" class="pg">
  <div id="err-users"></div>
  <input class="srch" id="srch-users" placeholder="Search users by name, email, role..." oninput="filterTable('tb-users', this.value)"/>
  <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Disciplines</th><th>Experience</th><th>Joined</th><th></th></tr></thead>
  <tbody id="tb-users"><tr><td colspan="8" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="pg-projects" class="pg">
  <div id="err-projects"></div>
  <table><thead><tr><th>Title</th><th>Type</th><th>Owner</th><th>Location</th><th>Remote</th><th>Interests</th><th>Status</th><th>Posted</th><th></th></tr></thead>
  <tbody id="tb-projects"><tr><td colspan="9" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="pg-interests" class="pg">
  <div id="err-interests"></div>
  <table><thead><tr><th>Project</th><th>Applicant</th><th>Email</th><th>Role Offer</th><th>Message</th><th>Portfolio</th><th>Status</th><th>Date</th></tr></thead>
  <tbody id="tb-interests"><tr><td colspan="8" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="pg-messages" class="pg">
  <div id="err-messages"></div>
  <table><thead><tr><th>Conversation</th><th>Type</th><th>Members</th><th>Last Message</th><th>Total Msgs</th><th>Created</th></tr></thead>
  <tbody id="tb-messages"><tr><td colspan="6" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="pg-events" class="pg">
  <div id="err-events"></div>
  <table><thead><tr><th>Title</th><th>Date</th><th>Location</th><th>Creator</th><th>Free?</th><th>RSVPs</th><th></th></tr></thead>
  <tbody id="tb-events"><tr><td colspan="7" class="loading">Loading...</td></tr></tbody></table>
</div>

<div id="toast"></div>

<script>
const KEY = '${key}';
const H = { 'x-admin-key': KEY, 'Content-Type': 'application/json' };

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showErr(tab, msg) {
  const el = document.getElementById('err-' + tab);
  if (el) el.innerHTML = '<div class="err">' + msg + '</div>';
}

function filterTable(tbId, q) {
  const rows = document.querySelectorAll('#' + tbId + ' tr');
  rows.forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('act'));
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('act'));
  document.querySelector('[data-tab="' + name + '"]').classList.add('act');
  document.getElementById('pg-' + name).classList.add('act');
  loadTab(name);
}

async function apiFetch(path) {
  const r = await fetch(path, { headers: H });
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + await r.text());
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('Expected array, got: ' + JSON.stringify(data).slice(0, 100));
  return data;
}

async function loadTab(name) {
  try {
    if (name === 'dashboard') await loadDashboard();
    else if (name === 'users') await loadUsers();
    else if (name === 'projects') await loadProjects();
    else if (name === 'interests') await loadInterests();
    else if (name === 'messages') await loadMessages();
    else if (name === 'events') await loadEvents();
  } catch(e) {
    showErr(name, 'Error: ' + e.message);
    console.error(name, e);
  }
}

async function loadDashboard() {
  const [users, projects, events, interests] = await Promise.all([
    apiFetch('/api/admin/users'),
    apiFetch('/api/admin/projects'),
    apiFetch('/api/admin/events'),
    apiFetch('/api/admin/interests'),
  ]);
  const week = new Date(Date.now() - 7 * 86400000);
  const newUsers = users.filter(u => new Date(u.created_at) > week).length;
  document.getElementById('stats').innerHTML = [
    { n: users.length,    l: 'Total Users' },
    { n: newUsers,        l: 'New This Week' },
    { n: projects.filter(p => p.status === 'open').length, l: 'Open Projects' },
    { n: interests.filter(i => i.status === 'pending').length, l: 'Pending Interests' },
    { n: interests.filter(i => i.status === 'accepted').length, l: 'Collabs Started' },
    { n: events.length,   l: 'Events' },
  ].map(s => '<div class="stat"><div class="stat-n">' + s.n + '</div><div class="stat-l">' + s.l + '</div></div>').join('');
  document.getElementById('tb-recent').innerHTML = users.length
    ? users.slice(0, 15).map(u =>
        '<tr><td><strong>' + u.name + '</strong></td><td class="email">' + u.email + '</td><td>' + (u.role || '—') + '</td><td>' + (u.location || '—') + '</td><td>' + fmt(u.created_at) + '</td></tr>'
      ).join('')
    : '<tr><td colspan="5" class="empty">No users yet</td></tr>';
}

async function loadUsers() {
  const users = await apiFetch('/api/admin/users');
  document.getElementById('tb-users').innerHTML = users.length
    ? users.map(u =>
        '<tr>' +
        '<td><strong>' + u.name + '</strong>' + (u.name_np ? '<br><small style="opacity:0.5">' + u.name_np + '</small>' : '') + '</td>' +
        '<td class="email">' + u.email + '</td>' +
        '<td>' + (u.role || '—') + '</td>' +
        '<td>' + (u.location || '—') + '</td>' +
        '<td>' + (Array.isArray(u.disciplines) ? u.disciplines.join(', ') : (u.disciplines || '—')) + '</td>' +
        '<td>' + (u.experience_years || 0) + ' yrs</td>' +
        '<td>' + fmt(u.created_at) + '</td>' +
        '<td><button class="btn d" onclick="deleteUser(\'' + u.id + '\',\'' + u.name.replace(/'/g, "\\'") + '\')">Delete</button></td>' +
        '</tr>'
      ).join('')
    : '<tr><td colspan="8" class="empty">No users yet</td></tr>';
}

async function loadProjects() {
  const projects = await apiFetch('/api/admin/projects');
  document.getElementById('tb-projects').innerHTML = projects.length
    ? projects.map(p =>
        '<tr>' +
        '<td><strong>' + p.title + '</strong></td>' +
        '<td>' + p.type + '</td>' +
        '<td>' + (p.owner_name || '?') + '</td>' +
        '<td>' + (p.location || '—') + '</td>' +
        '<td>' + (p.remote_ok ? '✓' : '✗') + '</td>' +
        '<td>' + (p.interest_count || 0) + '</td>' +
        '<td><span class="badge ' + p.status + '">' + p.status + '</span></td>' +
        '<td>' + fmt(p.created_at) + '</td>' +
        '<td><button class="btn d" onclick="closeProject(\'' + p.id + '\')">Close</button></td>' +
        '</tr>'
      ).join('')
    : '<tr><td colspan="9" class="empty">No projects yet</td></tr>';
}

async function loadInterests() {
  const interests = await apiFetch('/api/admin/interests');
  document.getElementById('tb-interests').innerHTML = interests.length
    ? interests.map(i =>
        '<tr>' +
        '<td>' + (i.project_title || '?') + '</td>' +
        '<td><strong>' + (i.user_name || '?') + '</strong></td>' +
        '<td class="email">' + (i.user_email || '—') + '</td>' +
        '<td>' + (i.role_offer || '—') + '</td>' +
        '<td class="prev">' + (i.message || '—') + '</td>' +
        '<td>' + (i.portfolio_link ? '<a href="' + i.portfolio_link + '" target="_blank" style="color:#C9922A">Link</a>' : '—') + '</td>' +
        '<td><span class="badge ' + (i.status || 'pending') + '">' + (i.status || 'pending') + '</span></td>' +
        '<td>' + fmt(i.created_at) + '</td>' +
        '</tr>'
      ).join('')
    : '<tr><td colspan="8" class="empty">No interests yet</td></tr>';
}

async function loadMessages() {
  const convs = await apiFetch('/api/admin/conversations');
  document.getElementById('tb-messages').innerHTML = convs.length
    ? convs.map(c =>
        '<tr>' +
        '<td>' + (c.name || (c.type === 'direct' ? 'Direct Message' : 'Group')) + '</td>' +
        '<td>' + c.type + '</td>' +
        '<td>' + (c.member_count || 0) + '</td>' +
        '<td class="prev">' + (c.last_msg || '—') + '</td>' +
        '<td>' + (c.msg_count || 0) + '</td>' +
        '<td>' + fmt(c.created_at) + '</td>' +
        '</tr>'
      ).join('')
    : '<tr><td colspan="6" class="empty">No conversations yet</td></tr>';
}

async function loadEvents() {
  const events = await apiFetch('/api/admin/events');
  document.getElementById('tb-events').innerHTML = events.length
    ? events.map(e =>
        '<tr>' +
        '<td><strong>' + e.title + '</strong></td>' +
        '<td>' + e.event_date + '</td>' +
        '<td>' + (e.location || '—') + '</td>' +
        '<td>' + (e.creator_name || '?') + '</td>' +
        '<td>' + (e.is_free ? '<span class="badge open">Free</span>' : '<span class="badge pending">Paid</span>') + '</td>' +
        '<td>' + (e.rsvp_count || 0) + '</td>' +
        '<td><button class="btn d" onclick="deleteEvent(\'' + e.id + '\')">Delete</button></td>' +
        '</tr>'
      ).join('')
    : '<tr><td colspan="7" class="empty">No events yet</td></tr>';
}

async function deleteUser(id, name) {
  if (!confirm('Delete user "' + name + '"? This cannot be undone.')) return;
  await fetch('/api/admin/users/' + id, { method: 'DELETE', headers: H });
  toast('User deleted');
  loadUsers();
  loadDashboard();
}

async function closeProject(id) {
  await fetch('/api/admin/projects/' + id + '/close', { method: 'PATCH', headers: H });
  toast('Project closed');
  loadProjects();
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await fetch('/api/admin/events/' + id, { method: 'DELETE', headers: H });
  toast('Event deleted');
  loadEvents();
}

// Load dashboard on start
loadDashboard();
</script>
</body>
</html>`);
});


app.get('/api/admin/users', adminAuth, async (req,res)=>res.json(await dbAll('SELECT id,name,name_np,email,role,location,disciplines,skills,experience_years,avatar_init,created_at FROM users ORDER BY created_at DESC')));
app.delete('/api/admin/users/:id', adminAuth, async (req,res)=>{ await db('DELETE FROM users WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.get('/api/admin/projects', adminAuth, async (req,res)=>res.json(await dbAll(`SELECT p.*,u.name as owner_name,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p LEFT JOIN users u ON p.owner_id=u.id ORDER BY p.created_at DESC`)));
app.patch('/api/admin/projects/:id/close', adminAuth, async (req,res)=>{ await db('UPDATE projects SET status=$1 WHERE id=$2',['closed',req.params.id]); res.json({ok:true}); });
app.get('/api/admin/interests', adminAuth, async (req,res)=>res.json(await dbAll(`SELECT i.*,p.title as project_title,u.name as user_name,u.email as user_email FROM interests i LEFT JOIN projects p ON i.project_id=p.id LEFT JOIN users u ON i.user_id=u.id ORDER BY i.created_at DESC`)));
app.get('/api/admin/conversations', adminAuth, async (req,res)=>res.json(await dbAll(`SELECT c.*,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count,(SELECT COUNT(*) FROM messages WHERE conv_id=c.id) as msg_count,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg FROM conversations c ORDER BY c.created_at DESC`)));
app.get('/api/admin/events', adminAuth, async (req,res)=>res.json(await dbAll(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`)));
app.delete('/api/admin/events/:id', adminAuth, async (req,res)=>{ await db('DELETE FROM events WHERE id=$1',[req.params.id]); res.json({ok:true}); });

// ─── Serve Frontend ───────────────────────────────────────────────────────────
const FRONTEND_PATHS = [
  path.join(__dirname, '../client/public'),
  path.join(process.cwd(), 'client/public'),
];
const publicDir = FRONTEND_PATHS.find(p => fs.existsSync(p)) || FRONTEND_PATHS[0];
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.setHeader('Content-Type','text/html');
    res.send('<h2>Kalachautari is starting up...</h2><p>Please refresh in a moment.</p>');
  }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  let userId = null;
  try { userId = jwt.verify(token, JWT_SECRET).id; wsClients.set(userId, ws); }
  catch { ws.close(); return; }
  ws.on('message', async raw => {
    try {
      const { event, data } = JSON.parse(raw);
      if (event === 'message') {
        const { conv_id, content } = data;
        if (!await dbOne('SELECT conv_id FROM conv_members WHERE conv_id=$1 AND user_id=$2', [conv_id,userId])) return;
        const id = uuid();
        await db(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES ($1,$2,$3,$4,$5)`, [id,conv_id,userId,'text',content]);
        const sender = await dbOne('SELECT name,avatar_init FROM users WHERE id=$1', [userId]);
        const msg = { id,conv_id,sender_id:userId,sender_name:sender.name,sender_init:sender.avatar_init,type:'text',content,created_at:new Date().toISOString() };
        const members = await dbAll('SELECT user_id FROM conv_members WHERE conv_id=$1', [conv_id]);
        members.forEach(m => {
          const mws = wsClients.get(m.user_id);
          if (mws && mws.readyState===WebSocket.OPEN) mws.send(JSON.stringify({ event:'message', data:msg }));
        });
      }
      if (event==='ping') ws.send(JSON.stringify({ event:'pong' }));
    } catch(e) { console.error('WS error:', e.message); }
  });
  ws.on('close', () => wsClients.delete(userId));
  ws.send(JSON.stringify({ event:'connected', data:{ userId } }));
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await setupSchema();
    await seedDemo();
    server.listen(PORT, () => {
      console.log(`\n🌿 Kalachautari running on http://localhost:${PORT}`);
      console.log(`   Demo login: aasha@demo.com / demo1234`);
      console.log(`   Admin: http://localhost:${PORT}/admin?key=${ADMIN_SECRET}\n`);
    });
  } catch(err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}
start();
