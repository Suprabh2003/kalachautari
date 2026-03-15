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
const initSqlJs    = require('sql.js');

const JWT_SECRET   = process.env.JWT_SECRET   || 'kalachautari-secret-2025';
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'kalachautari-admin-2025';
const PORT         = process.env.PORT          || 3000;
const DB_PATH      = path.join(__dirname, '../data/kalachautari.db');
const UPLOAD_DIR   = path.join(__dirname, '../uploads');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db;
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initDb(SQL) {
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run2 = function(sql, params) { this.run(sql, params || []); return this; };
  db.get2  = function(sql, params) {
    const s = this.prepare(sql); s.bind(params || []);
    if (s.step()) { const r = s.getAsObject(); s.free(); return r; }
    s.free(); return undefined;
  };
  db.all2  = function(sql, params) {
    const r = [], s = this.prepare(sql); s.bind(params || []);
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  db.prepare2 = function(sql) {
    const self = this;
    return {
      run(...p) { self.run(sql, p.flat()); saveDb(); },
      get(...p) { return self.get2(sql, p.flat()); },
      all(...p) { return self.all2(sql, p.flat()); },
    };
  };
  setupSchema();
  const count = db.get2('SELECT COUNT(*) as c FROM users');
  if (!count || count.c === 0) seedDemo();
}

function setupSchema() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_np TEXT DEFAULT '', email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT '', bio TEXT DEFAULT '', bio_np TEXT DEFAULT '', location TEXT DEFAULT '', disciplines TEXT DEFAULT '[]', skills TEXT DEFAULT '[]', genres TEXT DEFAULT '[]', avatar_init TEXT DEFAULT '', avatar_color TEXT DEFAULT 'rust', portfolio_links TEXT DEFAULT '[]', open_to_remote INTEGER DEFAULT 1, experience_years INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, title_np TEXT DEFAULT '', type TEXT NOT NULL, description TEXT DEFAULT '', description_np TEXT DEFAULT '', roles_needed TEXT DEFAULT '[]', timeline TEXT DEFAULT '', location TEXT DEFAULT '', remote_ok INTEGER DEFAULT 1, experience_req TEXT DEFAULT 'Any', max_collaborators INTEGER DEFAULT 5, status TEXT DEFAULT 'open', media_links TEXT DEFAULT '[]', cover_url TEXT DEFAULT '', view_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS interests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, role_offer TEXT DEFAULT '', message TEXT DEFAULT '', portfolio_link TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL, type TEXT DEFAULT 'connect', status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, type TEXT DEFAULT 'direct', project_id TEXT DEFAULT NULL, name TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS conv_members (conv_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, sender_id TEXT DEFAULT NULL, type TEXT DEFAULT 'text', content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, creator_id TEXT DEFAULT NULL, title TEXT NOT NULL, title_np TEXT DEFAULT '', description TEXT DEFAULT '', location TEXT DEFAULT '', event_date TEXT NOT NULL, event_time TEXT DEFAULT '', is_online INTEGER DEFAULT 0, is_free INTEGER DEFAULT 1, ticket_tiers TEXT DEFAULT '[]', tags TEXT DEFAULT '[]', cover_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS rsvps (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL, tier TEXT DEFAULT 'general', qty INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS portfolio_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, description TEXT DEFAULT '', file_url TEXT DEFAULT '', external_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '', read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  ];
  tables.forEach(t => db.run(t));
  saveDb();
}

function seedDemo() {
  console.log('Seeding demo data...');
  const hash = bcrypt.hashSync('demo1234', 10);
  const users = [
    ['u1','Aasha Gurung','आशा गुरुङ','aasha@demo.com',hash,'Singer · Songwriter','Folk-influenced indie artist from Pokhara.','Pokhara','["musician"]','["Vocals","Songwriting","Production"]','["Folk Fusion","Indie Pop"]','आ','rust',7],
    ['u2','Bikash Magar','बिकाश मगर','bikash@demo.com',hash,'Filmmaker · Director','Documentary filmmaker. 5 films, 3 intl festivals.','Kathmandu','["filmmaker"]','["Direction","Cinematography"]','["Documentary","Short Film"]','बि','blue',7],
    ['u3','Mira Thapa','मीरा थापा','mira@demo.com',hash,'Poet · Writer','Writing in Nepali and English. 3 anthologies.','London, UK','["writer"]','["Poetry","Short Fiction"]','["Poetry","Literary Fiction"]','मी','gold',6],
    ['u4','Sujen Rai','सुजन राई','sujen@demo.com',hash,'Guitarist · Producer','Folk fusion and indie rock. Remote welcome.','Sydney, AU','["musician"]','["Guitar","Production","Mixing"]','["Folk Fusion","Indie Rock"]','सु','rust',10],
    ['u5','Anita Lama','अनिता लामा','anita@demo.com',hash,'Illustrator','Thangka-inspired illustration. Album covers.','Pokhara','["visual"]','["Illustration","Design"]','["Visual Art"]','अ','green',5],
    ['u6','Roshan Tamang','रोशन तामाङ','roshan@demo.com',hash,'Screenwriter · Director','Short film specialist.','Paris, FR','["filmmaker"]','["Screenwriting","Direction"]','["Short Film","Drama"]','रो','blue',6],
  ];
  users.forEach(u => db.run2(`INSERT OR IGNORE INTO users (id,name,name_np,email,password,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, u));

  const projects = [
    ['p1','u1','Himalaya EP','हिमालय EP','Music','6-track folk fusion EP. Remote welcome.','नेपाली लोक धुनसँग इन्डी EP।','["Tabla Player","Videographer","Mixing Engineer"]','3-6 months','Pokhara',1],
    ['p2','u6','Bato — Short Film','बाटो — छोटो फिल्म','Film','20-min narrative short about migration. Script ready.','प्रवासबारे छोटो फिल्म।','["Cinematographer","Sound Designer","Lead Actor"]','1-3 months','Kathmandu',0],
    ['p3','u3','Kavita Sangrah','कविता संग्रह','Literature','Bilingual poetry collection. Seeking illustrator.','द्विभाषी कविता संग्रह।','["Illustrator","Book Designer"]','1-3 months','Remote',1],
    ['p4','u5','Thangka Meets Beat','थाङ्का मिट्स बिट','Visual Art','Thangka art + electronic music project.','थाङ्का कला र इलेक्ट्रोनिक संगीत।','["Electronic Producer","Animator"]','Ongoing','Remote',1],
  ];
  projects.forEach(p => db.run2(`INSERT OR IGNORE INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, p));

  const events = [
    ['e1','u1','Kala Saanjh — Open Mic','कला साँझ — ओपन माइक','Monthly open mic for Nepali creatives','Patan Dhoka, Lalitpur','2026-03-22','17:00',0,1,'["Music","Poetry","Free"]','[{"name":"General","price":0,"desc":"Open floor"},{"name":"Supporter","price":500,"desc":"Reserved seat"}]'],
    ['e2','u2','Diaspora Creatives Meetup','डायस्पोरा भेट','Networking for Nepali creatives in London','Nepal Centre, London','2026-04-05','15:00',0,0,'["Networking","All Arts"]','[{"name":"General","price":0,"desc":"Walk-in"},{"name":"VIP","price":1500,"desc":"Dinner included"}]'],
    ['e3','u6','Short Film Workshop','लघु फिल्म कार्यशाला','Online cinematography masterclass','Online (Zoom)','2026-04-18','18:00',1,0,'["Film","Workshop"]','[{"name":"Early Bird","price":500,"desc":"Limited"},{"name":"Standard","price":800,"desc":"Full access"}]'],
  ];
  events.forEach(e => db.run2(`INSERT OR IGNORE INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,tags,ticket_tiers) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, e));

  db.run2(`INSERT OR IGNORE INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`, ['c1','group','p1','Himalaya EP — Team']);
  ['u1','u2','u4'].forEach(uid => db.run2(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`, ['c1',uid]));
  db.run2(`INSERT OR IGNORE INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),'c1',null,'system','Group created: Himalaya EP Collaboration']);
  db.run2(`INSERT OR IGNORE INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),'c1','u2','text','Great session yesterday everyone!']);
  saveDb();
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
const possiblePublic = [
  path.join(__dirname, '../client/public'),
  path.join(__dirname, 'client/public'),
  path.join(process.cwd(), 'client/public'),
  path.join(process.cwd(), 'kalachautari/client/public'),
];
const publicDir = possiblePublic.find(p => { try { return fs.existsSync(p); } catch(e) { return false; } }) || possiblePublic[0];
console.log('Static files from:', publicDir, '| exists:', fs.existsSync(publicDir));
app.use(express.static(publicDir));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 100 * 1024 * 1024 } });
const wsClients = new Map();

function pushNotif(userId, type, title, body='', link='') {
  db.run2(`INSERT INTO notifications (id,user_id,type,title,body,link) VALUES (?,?,?,?,?,?)`, [uuid(),userId,type,title,body,link]);
  saveDb();
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event:'notification', data:{type,title,body,link} }));
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, location, disciplines } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:'Missing fields' });
  if (db.get2('SELECT id FROM users WHERE email=?', [email])) return res.status(409).json({ error:'Email already registered' });
  const id = uuid(), hash = bcrypt.hashSync(password, 10);
  const colors = ['rust','blue','gold','green'];
  db.run2(`INSERT INTO users (id,name,email,password,role,location,disciplines,avatar_init,avatar_color) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, email, hash, role||'', location||'', JSON.stringify(disciplines||[]), name.charAt(0).toUpperCase(), colors[Math.floor(Math.random()*4)]]);
  saveDb();
  const token = jwt.sign({id,name,email}, JWT_SECRET, {expiresIn:'30d'});
  res.json({ token, user: db.get2('SELECT id,name,name_np,email,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?', [id]) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.get2('SELECT * FROM users WHERE email=?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error:'Invalid credentials' });
  const token = jwt.sign({id:user.id, name:user.name, email:user.email}, JWT_SECRET, {expiresIn:'30d'});
  const safe = {...user}; delete safe.password;
  res.json({ token, user: safe });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', optAuth, (req, res) => {
  const { type, search } = req.query;
  let sql = `SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE 1=1`;
  const p = [];
  if (type)   { sql += ` AND disciplines LIKE ?`; p.push(`%${type}%`); }
  if (search) { sql += ` AND (name LIKE ? OR role LIKE ? OR skills LIKE ?)`; p.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  res.json(db.all2(sql + ` ORDER BY created_at DESC`, p));
});

app.get('/api/users/:id', (req, res) => {
  const u = db.get2('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote,created_at FROM users WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ error:'Not found' });
  u.projects  = db.all2('SELECT id,title,type,status FROM projects WHERE owner_id=? AND status="open"', [req.params.id]);
  u.portfolio = db.all2('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(u);
});

app.patch('/api/users/me', auth, (req, res) => {
  const { name, name_np, role, bio, bio_np, location, disciplines, skills, genres, experience_years, open_to_remote } = req.body;
  db.run2(`UPDATE users SET name=COALESCE(?,name),name_np=COALESCE(?,name_np),role=COALESCE(?,role),bio=COALESCE(?,bio),bio_np=COALESCE(?,bio_np),location=COALESCE(?,location),disciplines=COALESCE(?,disciplines),skills=COALESCE(?,skills),genres=COALESCE(?,genres),experience_years=COALESCE(?,experience_years),open_to_remote=COALESCE(?,open_to_remote) WHERE id=?`,
    [name,name_np,role,bio,bio_np,location,disciplines?JSON.stringify(disciplines):null,skills?JSON.stringify(skills):null,genres?JSON.stringify(genres):null,experience_years,open_to_remote!==undefined?(open_to_remote?1:0):null,req.user.id]);
  saveDb();
  res.json(db.get2('SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id=?', [req.user.id]));
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', optAuth, (req, res) => {
  const { type, remote, search, status } = req.query;
  let sql = `SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE 1=1`;
  const p = [];
  sql += status ? ` AND p.status=?` : ` AND p.status='open'`;
  if (status) p.push(status);
  if (type)   { sql += ` AND p.type=?`; p.push(type); }
  if (remote==='1') sql += ` AND p.remote_ok=1`;
  if (search) { sql += ` AND (p.title LIKE ? OR p.description LIKE ?)`; p.push(`%${search}%`,`%${search}%`); }
  res.json(db.all2(sql + ` ORDER BY p.created_at DESC`, p));
});

app.get('/api/projects/:id', optAuth, (req, res) => {
  const p = db.get2(`SELECT p.*,u.name as owner_name,u.avatar_init as owner_init,u.avatar_color as owner_color,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?`, [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  db.run2(`UPDATE projects SET view_count=view_count+1 WHERE id=?`, [req.params.id]); saveDb();
  if (req.user) p.my_interest = db.get2('SELECT * FROM interests WHERE project_id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json(p);
});

app.post('/api/projects', auth, (req, res) => {
  const { title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  db.run2(`INSERT INTO projects (id,owner_id,title,title_np,type,description,description_np,roles_needed,timeline,location,remote_ok,experience_req,max_collaborators,media_links,cover_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,req.user.id,title,title_np||'',type,description||'',description_np||'',JSON.stringify(roles_needed||[]),timeline||'',location||'',remote_ok?1:0,experience_req||'Any',max_collaborators||5,JSON.stringify(media_links||[]),cover_url||'']);
  saveDb();
  res.status(201).json(db.get2('SELECT p.*,u.name as owner_name,u.avatar_init as owner_init FROM projects p JOIN users u ON p.owner_id=u.id WHERE p.id=?', [id]));
});

app.patch('/api/projects/:id', auth, (req, res) => {
  const p = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { title,description,status,roles_needed } = req.body;
  db.run2(`UPDATE projects SET title=COALESCE(?,title),description=COALESCE(?,description),status=COALESCE(?,status),roles_needed=COALESCE(?,roles_needed) WHERE id=?`,
    [title,description,status,roles_needed?JSON.stringify(roles_needed):null,req.params.id]);
  saveDb(); res.json(db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]));
});

// ─── INTERESTS ────────────────────────────────────────────────────────────────
app.get('/api/projects/:id/interests', auth, (req, res) => {
  const p = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  res.json(db.all2(`SELECT i.*,u.name,u.name_np,u.role,u.avatar_init,u.avatar_color,u.location,u.skills FROM interests i JOIN users u ON i.user_id=u.id WHERE i.project_id=? ORDER BY i.created_at DESC`, [req.params.id]));
});

app.post('/api/projects/:id/interest', auth, (req, res) => {
  const project = db.get2('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!project) return res.status(404).json({ error:'Project not found' });
  if (project.owner_id===req.user.id) return res.status(400).json({ error:'Cannot express interest in your own project' });
  if (db.get2('SELECT id FROM interests WHERE project_id=? AND user_id=?', [req.params.id, req.user.id])) return res.status(409).json({ error:'Already expressed interest' });
  const { role_offer, message, portfolio_link } = req.body;
  const id = uuid();
  db.run2(`INSERT INTO interests (id,project_id,user_id,role_offer,message,portfolio_link) VALUES (?,?,?,?,?,?)`, [id,req.params.id,req.user.id,role_offer||'',message||'',portfolio_link||'']);
  saveDb();
  const iUser = db.get2('SELECT name FROM users WHERE id=?', [req.user.id]);
  pushNotif(project.owner_id, 'interest', `New interest in "${project.title}"`, `${iUser.name} wants to collaborate as: ${role_offer||'collaborator'}`, `/projects/${req.params.id}`);
  const ownerWs = wsClients.get(project.owner_id);
  if (ownerWs && ownerWs.readyState===WebSocket.OPEN)
    ownerWs.send(JSON.stringify({ event:'new_interest', data:{project_id:req.params.id,project_title:project.title,user_name:iUser.name,role_offer} }));
  res.status(201).json({ id, status:'pending' });
});

app.patch('/api/interests/:id', auth, (req, res) => {
  const interest = db.get2(`SELECT i.*,p.owner_id,p.title as project_title FROM interests i JOIN projects p ON i.project_id=p.id WHERE i.id=?`, [req.params.id]);
  if (!interest) return res.status(404).json({ error:'Not found' });
  if (interest.owner_id!==req.user.id) return res.status(403).json({ error:'Forbidden' });
  const { status } = req.body;
  db.run2(`UPDATE interests SET status=? WHERE id=?`, [status, req.params.id]); saveDb();
  if (status==='accepted') {
    const convId = uuid();
    db.run2(`INSERT INTO conversations (id,type,project_id,name) VALUES (?,?,?,?)`, [convId,'direct',interest.project_id,'']);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,req.user.id]);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,interest.user_id]);
    db.run2(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [uuid(),convId,null,'system',`Collaboration started on: ${interest.project_title}`]);
    saveDb();
    pushNotif(interest.user_id, 'accepted', 'Collaboration accepted!', `Your interest in "${interest.project_title}" was accepted.`, `/messages/${convId}`);
  } else if (status==='declined') {
    pushNotif(interest.user_id, 'declined', 'Interest update', `Your interest in "${interest.project_title}" was reviewed.`);
  }
  res.json({ ok:true, status });
});

// ─── MATCHES ──────────────────────────────────────────────────────────────────
app.post('/api/matches', auth, (req, res) => {
  const { target_id, type } = req.body;
  if (target_id===req.user.id) return res.status(400).json({ error:'Cannot match yourself' });
  if (db.get2('SELECT id FROM matches WHERE user_a=? AND user_b=?', [req.user.id,target_id])) return res.json({ matched:false, alreadyExists:true });
  db.run2(`INSERT INTO matches (id,user_a,user_b,type) VALUES (?,?,?,?)`, [uuid(),req.user.id,target_id,type||'connect']); saveDb();
  const mutual = db.get2(`SELECT id FROM matches WHERE user_a=? AND user_b=?`, [target_id,req.user.id]);
  let convId = null;
  if (mutual) {
    db.run2(`UPDATE matches SET status='matched' WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)`, [req.user.id,target_id,target_id,req.user.id]);
    convId = uuid();
    db.run2(`INSERT INTO conversations (id,type,name) VALUES (?,?,?)`, [convId,'direct','']);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,req.user.id]);
    db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [convId,target_id]);
    saveDb();
    const me = db.get2('SELECT name FROM users WHERE id=?', [req.user.id]);
    pushNotif(target_id, 'match', 'New Match!', `You and ${me.name} both want to connect!`, `/messages/${convId}`);
  }
  res.json({ matched:!!mutual, conv_id:convId });
});

app.get('/api/matches/suggestions', auth, (req, res) => {
  const me = db.get2('SELECT * FROM users WHERE id=?', [req.user.id]);
  const seen = db.all2(`SELECT user_b as id FROM matches WHERE user_a=? UNION SELECT user_a as id FROM matches WHERE user_b=?`, [req.user.id,req.user.id]).map(r=>r.id);
  seen.push(req.user.id);
  const ph = seen.map(()=>'?').join(',');
  const candidates = db.all2(`SELECT id,name,name_np,role,bio,location,disciplines,skills,genres,avatar_init,avatar_color,experience_years,open_to_remote FROM users WHERE id NOT IN (${ph}) ORDER BY RANDOM() LIMIT 20`, seen);
  const myGenres = JSON.parse(me.genres||'[]'), myDisc = JSON.parse(me.disciplines||'[]');
  const scored = candidates.map(u => {
    const overlap = JSON.parse(u.genres||'[]').filter(g=>myGenres.includes(g)).length;
    const diff = !myDisc.some(d=>JSON.parse(u.disciplines||'[]').includes(d));
    return { ...u, match_score: Math.min(99, 60+overlap*8+(diff?15:0)+(u.open_to_remote?5:0)+Math.floor(Math.random()*12)) };
  });
  res.json(scored.sort((a,b)=>b.match_score-a.match_score));
});

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────
app.get('/api/conversations', auth, (req, res) => {
  const convs = db.all2(`SELECT c.*,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg,(SELECT created_at FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count FROM conversations c JOIN conv_members cm ON c.id=cm.conv_id WHERE cm.user_id=? ORDER BY last_time DESC`, [req.user.id]);
  convs.forEach(c => { c.members = db.all2(`SELECT u.id,u.name,u.avatar_init,u.avatar_color FROM conv_members cm JOIN users u ON cm.user_id=u.id WHERE cm.conv_id=?`, [c.id]); });
  res.json(convs);
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  if (!db.get2('SELECT conv_id FROM conv_members WHERE conv_id=? AND user_id=?', [req.params.id,req.user.id])) return res.status(403).json({ error:'Not a member' });
  res.json(db.all2(`SELECT m.*,u.name as sender_name,u.avatar_init as sender_init FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.conv_id=? ORDER BY m.created_at ASC`, [req.params.id]));
});

app.post('/api/conversations', auth, (req, res) => {
  const { target_user_id, project_id } = req.body;
  if (target_user_id) {
    const ex = db.get2(`SELECT c.id FROM conversations c JOIN conv_members a ON c.id=a.conv_id AND a.user_id=? JOIN conv_members b ON c.id=b.conv_id AND b.user_id=? WHERE c.type='direct'`, [req.user.id,target_user_id]);
    if (ex) return res.json({ id:ex.id });
  }
  const id = uuid();
  db.run2(`INSERT INTO conversations (id,type,project_id) VALUES (?,?,?)`, [id,target_user_id?'direct':'group',project_id||null]);
  db.run2(`INSERT INTO conv_members (conv_id,user_id) VALUES (?,?)`, [id,req.user.id]);
  if (target_user_id) db.run2(`INSERT OR IGNORE INTO conv_members (conv_id,user_id) VALUES (?,?)`, [id,target_user_id]);
  saveDb(); res.status(201).json({ id });
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(db.all2(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`));
});

app.post('/api/events', auth, (req, res) => {
  const { title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags } = req.body;
  if (!title||!event_date) return res.status(400).json({ error:'title and event_date required' });
  const id = uuid();
  db.run2(`INSERT INTO events (id,creator_id,title,title_np,description,location,event_date,event_time,is_online,is_free,ticket_tiers,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,req.user.id,title,title_np||'',description||'',location||'',event_date,event_time||'',is_online?1:0,is_free?1:0,JSON.stringify(ticket_tiers||[]),JSON.stringify(tags||[])]);
  saveDb(); res.status(201).json(db.get2('SELECT * FROM events WHERE id=?', [id]));
});

app.post('/api/events/:id/rsvp', auth, (req, res) => {
  const ev = db.get2('SELECT * FROM events WHERE id=?', [req.params.id]);
  if (!ev) return res.status(404).json({ error:'Not found' });
  if (db.get2('SELECT id FROM rsvps WHERE event_id=? AND user_id=?', [req.params.id,req.user.id])) return res.status(409).json({ error:"Already RSVP'd" });
  const id = uuid();
  db.run2(`INSERT INTO rsvps (id,event_id,user_id,tier,qty) VALUES (?,?,?,?,?)`, [id,req.params.id,req.user.id,req.body.tier||'general',req.body.qty||1]);
  saveDb();
  pushNotif(req.user.id, 'rsvp', `RSVP confirmed: ${ev.title}`, `You're attending on ${ev.event_date}`);
  res.status(201).json({ id });
});

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────
app.get('/api/users/:id/portfolio', (req, res) => {
  res.json(db.all2('SELECT * FROM portfolio_items WHERE user_id=? ORDER BY created_at DESC', [req.params.id]));
});
app.post('/api/portfolio', auth, (req, res) => {
  const { title,type,description,file_url,external_url } = req.body;
  if (!title||!type) return res.status(400).json({ error:'title and type required' });
  const id = uuid();
  db.run2(`INSERT INTO portfolio_items (id,user_id,title,type,description,file_url,external_url) VALUES (?,?,?,?,?,?,?)`, [id,req.user.id,title,type,description||'',file_url||'',external_url||'']);
  saveDb(); res.status(201).json(db.get2('SELECT * FROM portfolio_items WHERE id=?', [id]));
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.all2('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]));
});
app.patch('/api/notifications/read', auth, (req, res) => {
  db.run2('UPDATE notifications SET read=1 WHERE user_id=?', [req.user.id]); saveDb(); res.json({ ok:true });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = `%${req.query.q||''}%`;
  res.json({
    users:    db.all2('SELECT id,name,role,avatar_init,avatar_color FROM users WHERE name LIKE ? OR role LIKE ? LIMIT 5', [q,q]),
    projects: db.all2('SELECT id,title,type FROM projects WHERE title LIKE ? AND status="open" LIMIT 5', [q]),
    events:   db.all2('SELECT id,title,event_date FROM events WHERE title LIKE ? LIMIT 5', [q]),
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
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Kalachautari Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&family=Yatra+One&display=swap" rel="stylesheet"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Mukta',sans-serif;background:#1A0F08;color:#F4ECD8}nav{background:#0F0804;border-bottom:3px solid #C9922A;padding:0 2rem;height:54px;display:flex;align-items:center;gap:1rem}nav h1{font-family:'Yatra One',serif;color:#C9922A;font-size:1.2rem}.tabs{display:flex;background:#140A05;border-bottom:1px solid rgba(255,255,255,0.08);padding:0 2rem}.tab{background:none;border:none;color:rgba(255,255,255,0.5);padding:12px 18px;cursor:pointer;font-family:'Mukta',sans-serif;font-size:0.82rem;border-bottom:2px solid transparent}.tab.act{color:#C9922A;border-bottom-color:#C9922A;font-weight:700}.pg{display:none;padding:2rem}.pg.act{display:block}table{width:100%;border-collapse:collapse;font-size:0.82rem}th{text-align:left;padding:8px 12px;font-size:0.68rem;text-transform:uppercase;color:rgba(255,255,255,0.4);border-bottom:1px solid rgba(255,255,255,0.08)}td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,0.05);vertical-align:top}tr:hover td{background:rgba(255,255,255,0.03)}.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700}.open{background:#1A4D2A;color:#6FCF97}.pending{background:#412402;color:#F0B86A}.accepted{background:#1A4D2A;color:#6FCF97}.closed{background:#4A1B0C;color:#F08070}.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}.stat{background:#0F0804;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:1.25rem;text-align:center}.stat-n{font-family:'Yatra One',serif;font-size:2rem;color:#C9922A}.stat-l{font-size:0.68rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:3px}.sec{font-family:'Yatra One',serif;font-size:1.1rem;color:#C9922A;margin-bottom:1rem}input.srch{background:#0F0804;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:6px 12px;color:#F4ECD8;font-family:'Mukta',sans-serif;font-size:0.82rem;width:280px;margin-bottom:1rem}.btn{background:#B8432F;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:0.72rem;font-weight:700}.btn.d{background:#4A1B0C}.prev{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.55);font-size:0.75rem}#toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#C9922A;color:#1A0F08;padding:10px 16px;border-radius:4px;font-size:0.82rem;font-weight:700;opacity:0;transition:opacity 0.3s;pointer-events:none}#toast.show{opacity:1}</style></head><body>
<nav><h1>कलाचौतारी Admin</h1><span style="color:rgba(255,255,255,0.4);font-size:0.75rem">Platform Management</span></nav>
<div class="tabs">
  <button class="tab act" onclick="showTab('dashboard',this)">Dashboard</button>
  <button class="tab" onclick="showTab('users',this)">Users</button>
  <button class="tab" onclick="showTab('projects',this)">Projects</button>
  <button class="tab" onclick="showTab('interests',this)">Interests</button>
  <button class="tab" onclick="showTab('messages',this)">Messages</button>
  <button class="tab" onclick="showTab('events',this)">Events</button>
</div>
<div id="pg-dashboard" class="pg act"><div class="stat-row" id="stats"></div><div class="sec">Recent Signups</div><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Joined</th></tr></thead><tbody id="ru"></tbody></table></div>
<div id="pg-users" class="pg"><input class="srch" placeholder="Search users..." oninput="filt('ut',this.value)"/><table id="ut"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Disciplines</th><th>Exp</th><th>Joined</th><th></th></tr></thead><tbody id="ub"></tbody></table></div>
<div id="pg-projects" class="pg"><table><thead><tr><th>Title</th><th>Type</th><th>Owner</th><th>Remote</th><th>Interests</th><th>Status</th><th>Posted</th><th></th></tr></thead><tbody id="pb"></tbody></table></div>
<div id="pg-interests" class="pg"><table><thead><tr><th>Project</th><th>Applicant</th><th>Email</th><th>Role Offer</th><th>Message</th><th>Portfolio</th><th>Status</th><th>Date</th></tr></thead><tbody id="ib"></tbody></table></div>
<div id="pg-messages" class="pg"><table><thead><tr><th>Conversation</th><th>Type</th><th>Members</th><th>Last Message</th><th>Total</th><th>Created</th></tr></thead><tbody id="mb"></tbody></table></div>
<div id="pg-events" class="pg"><table><thead><tr><th>Title</th><th>Date</th><th>Location</th><th>Creator</th><th>Free?</th><th>RSVPs</th><th></th></tr></thead><tbody id="eb"></tbody></table></div>
<div id="toast"></div>
<script>
const K='${key}',H={'x-admin-key':K,'Content-Type':'application/json'};
function fmt(d){return d?new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
function filt(id,q){document.querySelectorAll('#'+id+' tbody tr').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(q.toLowerCase())?'':'none'})}
async function showTab(t,btn){document.querySelectorAll('.pg').forEach(p=>p.classList.remove('act'));document.querySelectorAll('.tab').forEach(b=>b.classList.remove('act'));document.getElementById('pg-'+t).classList.add('act');btn.classList.add('act');if(t==='dashboard')await lDash();if(t==='users')await lUsers();if(t==='projects')await lProj();if(t==='interests')await lInt();if(t==='messages')await lMsgs();if(t==='events')await lEvs()}
async function lDash(){const[u,p,e,i]=await Promise.all([fetch('/api/admin/users',{headers:H}).then(r=>r.json()),fetch('/api/admin/projects',{headers:H}).then(r=>r.json()),fetch('/api/admin/events',{headers:H}).then(r=>r.json()),fetch('/api/admin/interests',{headers:H}).then(r=>r.json())]);document.getElementById('stats').innerHTML=[{n:u.length,l:'Users'},{n:p.filter(x=>x.status==='open').length,l:'Open Projects'},{n:i.filter(x=>x.status==='pending').length,l:'Pending Interests'},{n:e.length,l:'Events'}].map(s=>'<div class="stat"><div class="stat-n">'+s.n+'</div><div class="stat-l">'+s.l+'</div></div>').join('');document.getElementById('ru').innerHTML=u.slice(0,10).map(x=>'<tr><td>'+x.name+'</td><td style="color:#C9922A">'+x.email+'</td><td>'+(x.role||'—')+'</td><td>'+(x.location||'—')+'</td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lUsers(){const u=await fetch('/api/admin/users',{headers:H}).then(r=>r.json());document.getElementById('ub').innerHTML=u.map(x=>'<tr><td><strong>'+x.name+'</strong></td><td style="color:#C9922A">'+x.email+'</td><td>'+(x.role||'—')+'</td><td>'+(x.location||'—')+'</td><td>'+(JSON.parse(x.disciplines||'[]').join(', ')||'—')+'</td><td>'+(x.experience_years||0)+'yr</td><td>'+fmt(x.created_at)+'</td><td><button class="btn d" onclick="dUser(\''+x.id+'\',\''+x.name.replace(/'/g,"\\'")+'\')" >Delete</button></td></tr>').join('')}
async function lProj(){const p=await fetch('/api/admin/projects',{headers:H}).then(r=>r.json());document.getElementById('pb').innerHTML=p.map(x=>'<tr><td><strong>'+x.title+'</strong></td><td>'+x.type+'</td><td>'+(x.owner_name||'?')+'</td><td>'+(x.remote_ok?'✓':'✗')+'</td><td>'+(x.interest_count||0)+'</td><td><span class="badge '+x.status+'">'+x.status+'</span></td><td>'+fmt(x.created_at)+'</td><td><button class="btn d" onclick="cProj(\''+x.id+'\')">Close</button></td></tr>').join('')}
async function lInt(){const i=await fetch('/api/admin/interests',{headers:H}).then(r=>r.json());document.getElementById('ib').innerHTML=i.map(x=>'<tr><td>'+(x.project_title||'?')+'</td><td><strong>'+(x.user_name||'?')+'</strong></td><td style="color:#C9922A">'+(x.user_email||'')+'</td><td>'+(x.role_offer||'—')+'</td><td class="prev">'+(x.message||'—')+'</td><td>'+(x.portfolio_link?'<a href="'+x.portfolio_link+'" target="_blank" style="color:#C9922A">Link</a>':'—')+'</td><td><span class="badge '+(x.status||'pending')+'">'+(x.status||'pending')+'</span></td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lMsgs(){const c=await fetch('/api/admin/conversations',{headers:H}).then(r=>r.json());document.getElementById('mb').innerHTML=c.map(x=>'<tr><td>'+(x.name||(x.type==='direct'?'Direct':'Group'))+'</td><td>'+x.type+'</td><td>'+(x.member_count||0)+'</td><td class="prev">'+(x.last_msg||'—')+'</td><td>'+(x.msg_count||0)+'</td><td>'+fmt(x.created_at)+'</td></tr>').join('')}
async function lEvs(){const e=await fetch('/api/admin/events',{headers:H}).then(r=>r.json());document.getElementById('eb').innerHTML=e.map(x=>'<tr><td><strong>'+x.title+'</strong></td><td>'+x.event_date+'</td><td>'+(x.location||'—')+'</td><td>'+(x.creator_name||'?')+'</td><td>'+(x.is_free?'Free':'Paid')+'</td><td>'+(x.rsvp_count||0)+'</td><td><button class="btn d" onclick="dEv(\''+x.id+'\')">Delete</button></td></tr>').join('')}
async function dUser(id,name){if(!confirm('Delete '+name+'?'))return;await fetch('/api/admin/users/'+id,{method:'DELETE',headers:H});toast('Deleted');lUsers()}
async function cProj(id){await fetch('/api/admin/projects/'+id+'/close',{method:'PATCH',headers:H});toast('Closed');lProj()}
async function dEv(id){if(!confirm('Delete?'))return;await fetch('/api/admin/events/'+id,{method:'DELETE',headers:H});toast('Deleted');lEvs()}
lDash();
</script></body></html>`);
});

app.get('/api/admin/users',        adminAuth, (req,res)=>res.json(db.all2('SELECT id,name,name_np,email,role,location,disciplines,skills,experience_years,avatar_init,created_at FROM users ORDER BY created_at DESC')));
app.delete('/api/admin/users/:id', adminAuth, (req,res)=>{ db.run2('DELETE FROM users WHERE id=?',[req.params.id]); saveDb(); res.json({ok:true}); });
app.get('/api/admin/projects',     adminAuth, (req,res)=>res.json(db.all2(`SELECT p.*,u.name as owner_name,(SELECT COUNT(*) FROM interests WHERE project_id=p.id) as interest_count FROM projects p LEFT JOIN users u ON p.owner_id=u.id ORDER BY p.created_at DESC`)));
app.patch('/api/admin/projects/:id/close', adminAuth, (req,res)=>{ db.run2('UPDATE projects SET status=? WHERE id=?',['closed',req.params.id]); saveDb(); res.json({ok:true}); });
app.get('/api/admin/interests',    adminAuth, (req,res)=>res.json(db.all2(`SELECT i.*,p.title as project_title,u.name as user_name,u.email as user_email FROM interests i LEFT JOIN projects p ON i.project_id=p.id LEFT JOIN users u ON i.user_id=u.id ORDER BY i.created_at DESC`)));
app.get('/api/admin/conversations',adminAuth, (req,res)=>res.json(db.all2(`SELECT c.*,(SELECT COUNT(*) FROM conv_members WHERE conv_id=c.id) as member_count,(SELECT COUNT(*) FROM messages WHERE conv_id=c.id) as msg_count,(SELECT content FROM messages WHERE conv_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg FROM conversations c ORDER BY c.created_at DESC`)));
app.get('/api/admin/events',       adminAuth, (req,res)=>res.json(db.all2(`SELECT e.*,u.name as creator_name,(SELECT COUNT(*) FROM rsvps WHERE event_id=e.id) as rsvp_count FROM events e LEFT JOIN users u ON e.creator_id=u.id ORDER BY e.event_date ASC`)));
app.delete('/api/admin/events/:id',adminAuth, (req,res)=>{ db.run2('DELETE FROM events WHERE id=?',[req.params.id]); saveDb(); res.json({ok:true}); });

// ─── Fallback SPA (HTML inlined to avoid path issues) ────────────────────────
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Kalachautari — कलाचौतारी</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Nepali:ital@0;1&family=Mukta:wght@300;400;600;700&family=Yatra+One&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --rust:#B8432F;--rust2:#8C2E1A;--rust-light:#FAF0EC;
  --cream:#FBF6EE;--cream2:#F4ECD8;--cream3:#EDE0C8;
  --ink:#1A0F08;--muted:#6B4F3A;--muted2:#9B7B60;
  --gold:#C9922A;--gold2:#A87820;--gold-light:#FDF5E6;
  --himalaya:#1E4D7A;--himalaya2:#163A5E;--himalaya-light:#EAF1F8;
  --green:#2A6B3C;--green-light:#EAF4EE;
  --border:rgba(26,15,8,0.12);--border2:rgba(26,15,8,0.06);
  --card:#FFFCF7;
}
body{font-family:'Mukta',sans-serif;background:var(--cream);color:var(--ink);font-size:14px;line-height:1.5;overflow-x:hidden}
.np{font-family:'Tiro Devanagari Nepali','Mukta',sans-serif}
.yatra{font-family:'Yatra One','Tiro Devanagari Nepali',serif}

/* LANG */
.en-t{display:inline}.np-t{display:none}
body.nepali .en-t{display:none}body.nepali .np-t{display:inline}

/* ANIMATIONS */
@keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes countUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulseDot{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.2);opacity:1}}

.fade-up{animation:fadeUp 0.7s cubic-bezier(.22,1,.36,1) both}
.fade-up-1{animation:fadeUp 0.7s 0.12s cubic-bezier(.22,1,.36,1) both}
.fade-up-2{animation:fadeUp 0.7s 0.22s cubic-bezier(.22,1,.36,1) both}
.fade-up-3{animation:fadeUp 0.7s 0.32s cubic-bezier(.22,1,.36,1) both}

/* DHAKA TEXTURE */
.dhaka{background-image:
  repeating-linear-gradient(90deg,rgba(201,146,42,0.07) 0,rgba(201,146,42,0.07) 1px,transparent 1px,transparent 14px),
  repeating-linear-gradient(0deg,rgba(201,146,42,0.07) 0,rgba(201,146,42,0.07) 1px,transparent 1px,transparent 14px),
  repeating-linear-gradient(45deg,rgba(184,67,47,0.04) 0,rgba(184,67,47,0.04) 1px,transparent 1px,transparent 8px);}

/* CANVAS */
#fc{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.45}

/* AUTH */
#auth-screen{display:flex;min-height:100vh;align-items:center;justify-content:center;background:var(--ink);padding:1rem;position:relative;overflow:hidden}
.auth-box{background:var(--cream);border-radius:12px;width:100%;max-width:430px;overflow:hidden;position:relative;z-index:1;animation:fadeUp 0.8s cubic-bezier(.22,1,.36,1)}
.auth-header{background:var(--ink);padding:2rem 1.5rem;text-align:center;border-bottom:3px solid var(--gold);position:relative;overflow:hidden}
.auth-header::before{content:'';position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(201,146,42,0.05) 0,rgba(201,146,42,0.05) 1px,transparent 1px,transparent 8px)}
.auth-logo{font-family:'Yatra One',serif;font-size:2.4rem;color:var(--gold);display:block;margin-bottom:4px;position:relative;z-index:1}
.auth-sub{font-size:0.65rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:2px;position:relative;z-index:1}
.auth-mandala{position:absolute;opacity:0.08}
.auth-tabs{display:flex;border-bottom:1px solid var(--border)}
.auth-tab{flex:1;background:none;border:none;padding:0.875rem;font-family:'Mukta',sans-serif;font-size:0.87rem;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;transition:all 0.2s}
.auth-tab.act{color:var(--rust);border-bottom-color:var(--rust);font-weight:700}
.auth-form{padding:1.25rem;display:none}
.auth-form.act{display:block;animation:fadeIn 0.3s ease}
.fgrp{margin-bottom:0.875rem}
.flbl{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px;display:block}
.finp{width:100%;border:1px solid var(--border);border-radius:5px;padding:9px 13px;font-family:'Mukta',sans-serif;font-size:0.87rem;background:var(--card);color:var(--ink);transition:all 0.2s}
.finp:focus{outline:none;border-color:var(--rust);box-shadow:0 0 0 3px rgba(184,67,47,0.09)}
select.finp{cursor:pointer}
textarea.finp{resize:none}
.auth-err{color:var(--rust);font-size:0.78rem;margin-bottom:0.5rem;min-height:18px}
.demo-hint{font-size:0.72rem;color:var(--muted);text-align:center;margin-top:0.75rem;padding:6px 10px;background:var(--cream2);border-radius:4px}

/* APP */
#app{display:none;position:relative;z-index:1}

/* NAV */
#nav{background:var(--ink);padding:0 1.75rem;display:flex;align-items:center;height:58px;position:sticky;top:0;z-index:100;border-bottom:1px solid rgba(255,255,255,0.06)}
.nav-gold-line{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--rust) 20%,var(--gold) 50%,var(--rust) 80%,transparent);background-size:200% 100%;animation:shimmer 4s linear infinite}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;margin-right:1rem}
.logo-icon{width:36px;height:36px;background:var(--rust);border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;flex-shrink:0;transition:all 0.2s;position:relative;overflow:hidden}
.logo-icon::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,0);transition:background 0.2s}
.logo:hover .logo-icon{transform:rotate(-6deg) scale(1.06)}
.logo-txt{color:#fff;font-size:1.2rem;line-height:1}
.logo-sub{color:var(--gold);font-size:0.58rem;letter-spacing:1.2px;text-transform:uppercase;opacity:0.8}
.nav-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.58);font-size:0.78rem;padding:6px 11px;border-radius:4px;font-family:'Mukta',sans-serif;transition:all 0.18s;white-space:nowrap;position:relative}
.nav-btn:hover{color:#fff;background:rgba(255,255,255,0.07)}
.nav-btn.act{color:#fff;font-weight:700}
.nav-btn.act::after{content:'';position:absolute;bottom:-1px;left:8px;right:8px;height:2px;background:var(--gold);border-radius:2px}
.nbadge{position:absolute;top:3px;right:3px;background:var(--rust);color:#fff;font-size:0.55rem;padding:1px 4px;border-radius:8px;min-width:14px;text-align:center;animation:pulseDot 2s infinite}
.lang-tog{display:flex;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:3px;margin-left:auto}
.lng{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.48);font-size:0.7rem;padding:3px 9px;border-radius:12px;font-family:'Mukta',sans-serif;transition:all 0.2s}
.lng.act{background:var(--rust);color:#fff}
.nav-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700;color:#fff;cursor:pointer;transition:all 0.2s;overflow:hidden;flex-shrink:0;border:2px solid rgba(255,255,255,0.2)}
.nav-av:hover{transform:scale(1.08);border-color:var(--gold)}
.nav-av img{width:100%;height:100%;object-fit:cover}

/* PAGES */
.page{display:none;min-height:calc(100vh - 58px)}
.page.act{display:block}
.pi{padding:1.75rem 2rem;max-width:1300px;margin:0 auto}

/* HERO */
.hero{background:var(--ink);position:relative;overflow:hidden;border-bottom:1px solid rgba(255,255,255,0.06)}
.hero-inner{max-width:1300px;margin:0 auto;padding:3.5rem 2rem;display:grid;grid-template-columns:1fr 320px;gap:3.5rem;align-items:center;position:relative;z-index:2}
.hero-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(184,67,47,0.2);border:1px solid rgba(184,67,47,0.4);color:rgba(255,255,255,0.85);font-size:0.62rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:20px;margin-bottom:1rem}
.hero-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--rust);animation:pulseDot 2s infinite}
.hero h1{font-family:'Yatra One',serif;font-size:2.6rem;color:#fff;line-height:1.1;margin-bottom:0.75rem}
.hero h1 em{color:var(--gold);font-style:normal}
.hero-sub{color:rgba(255,255,255,0.55);font-size:0.9rem;margin-bottom:1.75rem;line-height:1.65;max-width:500px}
.hero-btns{display:flex;gap:10px;flex-wrap:wrap}
.hero-mandala-wrap{position:absolute;right:-80px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:0.07}
.hero-mandala-wrap svg{width:480px;height:480px;animation:spin 80s linear infinite}
.hero-bg-lines{position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(201,146,42,0.025) 0,rgba(201,146,42,0.025) 1px,transparent 1px,transparent 10px);z-index:1}
.stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:rgba(255,255,255,0.07);border-radius:8px;overflow:hidden}
.stat-box{padding:1.4rem 1rem;text-align:center;background:rgba(255,255,255,0.035);transition:background 0.2s;cursor:default}
.stat-box:hover{background:rgba(255,255,255,0.065)}
.stat-n{font-family:'Yatra One',serif;font-size:2rem;color:var(--gold);display:block;line-height:1}
.stat-l{font-size:0.6rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.2px;margin-top:5px}
.stat-box .ornament{display:block;font-size:1.1rem;margin-bottom:4px;opacity:0.5}

/* SECTION TITLE */
.stitle{font-family:'Yatra One',serif;font-size:1.35rem;color:var(--ink);margin-bottom:1.25rem;display:flex;align-items:center;gap:10px}
.stitle::after{content:'';flex:1;height:1px;background:var(--border)}
.stitle .orn{color:var(--gold);font-size:0.9rem;opacity:0.7;margin-right:-4px}

/* BUTTONS */
.btn-p{background:var(--rust);color:#fff;border:none;padding:10px 22px;border-radius:5px;font-family:'Mukta',sans-serif;font-size:0.84rem;font-weight:700;cursor:pointer;transition:all 0.2s;position:relative;overflow:hidden}
.btn-p:hover{background:var(--rust2);transform:translateY(-2px)}
.btn-p:active{transform:translateY(0)}
.btn-p:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.btn-o{background:none;color:var(--ink);border:1.5px solid var(--border);padding:9px 20px;border-radius:5px;font-family:'Mukta',sans-serif;font-size:0.84rem;cursor:pointer;transition:all 0.2s}
.btn-o:hover{border-color:var(--rust);color:var(--rust);transform:translateY(-1px)}
.btn-g{background:var(--gold);color:var(--ink);border:none;padding:9px 20px;border-radius:5px;font-family:'Mukta',sans-serif;font-size:0.84rem;font-weight:700;cursor:pointer;transition:all 0.2s}
.btn-g:hover{background:var(--gold2);color:#fff;transform:translateY(-1px)}
.btn-sm{background:none;color:var(--ink);border:1px solid var(--border);padding:4px 11px;border-radius:4px;font-family:'Mukta',sans-serif;font-size:0.72rem;cursor:pointer;transition:all 0.15s}
.btn-sm:hover{border-color:var(--rust);color:var(--rust)}

/* FILTER */
.fbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1.25rem;align-items:center}
.fpill{background:var(--card);border:1.5px solid var(--border);color:var(--muted);font-size:0.72rem;padding:5px 15px;border-radius:20px;cursor:pointer;font-family:'Mukta',sans-serif;transition:all 0.2s;font-weight:500}
.fpill:hover{border-color:var(--rust);color:var(--rust)}
.fpill.act{background:var(--rust);color:#fff;border-color:var(--rust)}
.srch{border:1.5px solid var(--border);border-radius:22px;padding:7px 16px;font-family:'Mukta',sans-serif;font-size:0.82rem;background:var(--card);color:var(--ink);min-width:210px;transition:all 0.2s}
.srch:focus{outline:none;border-color:var(--rust);box-shadow:0 0 0 3px rgba(184,67,47,0.09)}

/* TAGS */
.tag{background:var(--cream2);color:var(--muted);font-size:0.67rem;padding:2px 8px;border-radius:3px;font-weight:600;display:inline-block}
.tag.rust{background:var(--rust-light);color:var(--rust2)}
.tag.gold{background:var(--gold-light);color:var(--gold2)}
.tag.blue{background:var(--himalaya-light);color:var(--himalaya2)}
.tag.green{background:var(--green-light);color:var(--green)}

/* GRIDS */
.g3{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1.25rem}
.g2{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:1.25rem}

/* CARDS */
.card{background:var(--card);border:1.5px solid var(--border);border-radius:10px;transition:all 0.25s;overflow:hidden}
.card:hover{border-color:rgba(184,67,47,0.3);transform:translateY(-4px);box-shadow:0 12px 32px rgba(26,15,8,0.09)}

/* CREATOR CARD */
.cc-banner{height:70px;position:relative;overflow:hidden}
.cc-banner.rust{background:linear-gradient(135deg,var(--rust2) 0%,#6B2010 100%)}
.cc-banner.blue{background:linear-gradient(135deg,var(--himalaya2) 0%,#0D2A45 100%)}
.cc-banner.gold{background:linear-gradient(135deg,var(--gold2) 0%,#6B4E10 100%)}
.cc-banner.green{background:linear-gradient(135deg,var(--green) 0%,#1A4525 100%)}
.cc-pat{position:absolute;inset:0;opacity:0.18;background-image:repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 9px),repeating-linear-gradient(-45deg,#fff 0,#fff 1px,transparent 0,transparent 9px);background-size:9px 9px}
.cc-av{width:50px;height:50px;border-radius:50%;border:3px solid var(--card);position:absolute;bottom:-25px;left:1rem;display:flex;align-items:center;justify-content:center;font-family:'Yatra One',serif;font-size:1.1rem;color:var(--rust);font-weight:700;transition:transform 0.2s;overflow:hidden}
.cc-av img{width:100%;height:100%;object-fit:cover}
.cc-av-bg{background:var(--cream2)}
.card:hover .cc-av{transform:scale(1.08)}
.cc-body{padding:1.6rem 1.1rem 1.1rem}
.cc-name{font-weight:700;font-size:0.95rem;margin-bottom:1px}
.cc-role{font-size:0.7rem;color:var(--rust);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px}
.cc-bio{font-size:0.78rem;color:var(--muted);line-height:1.45;margin-bottom:9px}
.cc-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:9px;margin-top:9px}
.cc-loc{font-size:0.68rem;color:var(--muted2)}

/* PROJECT CARD */
.pc-head{padding:1rem 1.1rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.pc-title{font-weight:700;font-size:0.92rem;margin-bottom:2px}
.pc-body{padding:0.875rem 1.1rem}
.pc-desc{font-size:0.78rem;color:var(--muted);line-height:1.45;margin-bottom:8px}
.need{display:inline-block;background:var(--rust);color:#fff;font-size:0.63rem;padding:2px 9px;border-radius:10px;margin:2px;opacity:0.88;transition:opacity 0.15s}
.need:hover{opacity:1}
.pc-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding:8px 1.1rem}
.ow-av{width:25px;height:25px;border-radius:50%;background:var(--cream2);display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:var(--rust);flex-shrink:0;overflow:hidden}
.ow-av img{width:100%;height:100%;object-fit:cover}

/* SWIPE */
.swipe-stack{position:relative;width:330px;height:460px;margin:0 auto}
.swipe-card{position:absolute;inset:0;background:var(--card);border:1.5px solid var(--border);border-radius:14px;overflow:hidden;transition:transform 0.35s cubic-bezier(.34,1.56,.64,1),opacity 0.3s;cursor:grab}
.swipe-card:active{cursor:grabbing}
.swipe-card.gone-l{transform:translateX(-130%) rotate(-15deg);opacity:0;pointer-events:none}
.swipe-card.gone-r{transform:translateX(130%) rotate(15deg);opacity:0;pointer-events:none}
.swipe-card.back{transform:scale(0.96) translateY(10px);z-index:0}
.swipe-card.front{z-index:1}
.sw-banner{height:95px;position:relative}
.sw-av{width:56px;height:56px;border-radius:50%;border:3px solid var(--card);position:absolute;bottom:-28px;left:1.25rem;display:flex;align-items:center;justify-content:center;font-family:'Yatra One',serif;font-size:1.2rem;color:var(--rust);overflow:hidden}
.sw-av img{width:100%;height:100%;object-fit:cover}
.sw-info{padding:1.9rem 1.25rem 1.25rem}
.sw-name{font-weight:700;font-size:1.05rem;margin-bottom:2px}
.sw-role{font-size:0.72rem;color:var(--rust);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
.match-score{background:var(--gold-light);border:1px solid rgba(201,146,42,0.25);border-radius:5px;padding:5px 10px;font-size:0.75rem;margin-bottom:9px}
.match-score strong{color:var(--gold2)}
.sw-actions{display:flex;justify-content:center;gap:16px;margin-top:1rem}
.sw-btn{width:54px;height:54px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.1rem;background:var(--card);transition:all 0.2s}
.sw-btn:hover{transform:scale(1.13)}
.sw-btn.pass{border-color:var(--muted);color:var(--muted)}.sw-btn.pass:hover{background:var(--cream2)}
.sw-btn.conn{border-color:var(--rust);color:var(--rust)}.sw-btn.conn:hover{background:var(--rust-light)}
.sw-btn.star{border-color:var(--gold);color:var(--gold)}.sw-btn.star:hover{background:var(--gold-light)}
.match-pop{background:var(--ink);color:#fff;border-radius:12px;padding:1.75rem;text-align:center;border:1px solid var(--gold)}
.match-pop .mp-t{font-family:'Yatra One',serif;font-size:1.5rem;color:var(--gold);margin-bottom:6px}

/* EVENTS */
.ev-card{background:var(--card);border:1.5px solid var(--border);border-radius:10px;display:flex;overflow:hidden;transition:all 0.25s}
.ev-card:hover{border-color:rgba(201,146,42,0.45);transform:translateY(-3px);box-shadow:0 8px 24px rgba(26,15,8,0.08)}
.ev-date{min-width:68px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem 0.6rem;flex-shrink:0;position:relative}
.ev-date.free{background:var(--rust)}.ev-date.paid{background:var(--ink)}
.ev-day{font-family:'Yatra One',serif;font-size:1.9rem;line-height:1;color:#fff}
.ev-mon{font-size:0.62rem;text-transform:uppercase;letter-spacing:1px;opacity:0.8;color:#fff}
.ev-body{padding:0.9rem 1rem;flex:1}
.ev-title{font-weight:700;font-size:0.9rem;margin-bottom:3px}
.ev-meta{font-size:0.73rem;color:var(--muted);margin-bottom:6px}
.ev-act{display:flex;flex-direction:column;justify-content:center;padding:0.875rem;gap:6px;border-left:1px solid var(--border);min-width:84px}

/* FORUM */
.forum-card{background:var(--card);border:1.5px solid var(--border);border-radius:10px;padding:1.25rem;transition:all 0.22s;cursor:pointer}
.forum-card:hover{border-color:rgba(184,67,47,0.3);transform:translateY(-3px);box-shadow:0 8px 24px rgba(26,15,8,0.08)}
.forum-av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Yatra One',serif;font-size:0.9rem;color:#fff;flex-shrink:0;overflow:hidden}
.forum-av img{width:100%;height:100%;object-fit:cover}
.forum-av.rust{background:var(--rust)}.forum-av.blue{background:var(--himalaya)}.forum-av.gold{background:var(--gold)}.forum-av.green{background:var(--green)}
.forum-title{font-weight:700;font-size:0.9rem;margin-bottom:4px}
.forum-preview{font-size:0.78rem;color:var(--muted);line-height:1.4;margin-bottom:8px}
.forum-meta{font-size:0.7rem;color:var(--muted2);display:flex;gap:12px;align-items:center}
.fcat{display:inline-block;font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 9px;border-radius:10px}
.fcat.music{background:#FDF0E0;color:#8C5A0A}.fcat.film{background:#E8EEF6;color:#1A3E6B}
.fcat.art{background:#F0E8F6;color:#4A1A6B}.fcat.general{background:var(--cream2);color:var(--muted)}
.fcat.inspo{background:#E8F4EC;color:#1A4D2A}

/* MESSAGES */
.msg-wrap{border:1.5px solid var(--border);border-radius:10px;overflow:hidden;background:var(--card)}
.msg-layout{display:grid;grid-template-columns:250px 1fr;height:550px}
.conv-list{border-right:1px solid var(--border);overflow-y:auto;background:var(--card)}
.conv-hd{padding:0.875rem;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.ci{padding:0.875rem;border-bottom:1px solid var(--border2);cursor:pointer;transition:background 0.1s}
.ci:hover{background:var(--cream2)}
.ci.act{background:var(--cream2);border-left:3px solid var(--rust)}
.ci-name{font-size:0.82rem;font-weight:700}
.ci-prev{font-size:0.7rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:175px}
.ci-t{font-size:0.62rem;color:var(--muted2)}
.chat-main{display:flex;flex-direction:column}
.chat-hd{padding:0.875rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px;flex-shrink:0}
.chat-av{width:34px;height:34px;border-radius:50%;background:var(--cream2);display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;color:var(--rust);flex-shrink:0;overflow:hidden}
.chat-av img{width:100%;height:100%;object-fit:cover}
.chat-av.grp{background:var(--himalaya-light);color:var(--himalaya2)}
.chat-msgs{flex:1;padding:1rem;overflow-y:auto;display:flex;flex-direction:column;gap:8px;background:var(--cream)}
.msg{max-width:72%}
.msg.out{align-self:flex-end}
.mbub{padding:8px 13px;border-radius:9px;font-size:0.81rem;line-height:1.45}
.msg.in .mbub{background:var(--card);color:var(--ink)}
.msg.out .mbub{background:var(--rust);color:#fff}
.msg.sys{align-self:center;max-width:90%}
.msg.sys .mbub{background:var(--cream2);color:var(--muted);font-size:0.7rem;text-align:center;border-radius:10px}
.mt{font-size:0.62rem;color:var(--muted2);margin-top:2px}
.msg.out .mt{text-align:right}
.chat-inp{border-top:1px solid var(--border);padding:0.625rem;display:flex;gap:6px;flex-shrink:0}
.chat-inp input{flex:1;border:1.5px solid var(--border);border-radius:22px;padding:7px 15px;font-size:0.81rem;font-family:'Mukta',sans-serif;background:var(--cream);color:var(--ink);transition:border-color 0.2s}
.chat-inp input:focus{outline:none;border-color:var(--rust)}
.chat-send{background:var(--rust);color:#fff;border:none;padding:7px 17px;border-radius:22px;cursor:pointer;font-size:0.78rem;transition:background 0.15s}
.chat-send:hover{background:var(--rust2)}

/* PROFILE - RICH */
.prof-wrap{display:grid;grid-template-columns:300px 1fr;gap:1.75rem}
.prof-side{background:var(--card);border:1.5px solid var(--border);border-radius:10px;overflow:hidden}
.prof-banner{height:100px;position:relative;overflow:hidden}
.prof-banner.rust{background:linear-gradient(135deg,var(--rust2) 0%,#5A1A0A 100%)}
.prof-banner.blue{background:linear-gradient(135deg,var(--himalaya2) 0%,#0A1E30 100%)}
.prof-banner.gold{background:linear-gradient(135deg,var(--gold2) 0%,#5A3A08 100%)}
.prof-banner.green{background:linear-gradient(135deg,var(--green) 0%,#0F2E1A 100%)}
.prof-banner-pat{position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.07) 0,rgba(255,255,255,0.07) 1px,transparent 1px,transparent 9px),repeating-linear-gradient(-45deg,rgba(255,255,255,0.07) 0,rgba(255,255,255,0.07) 1px,transparent 1px,transparent 9px)}
.prof-banner-edit{position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,0.45);color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:'Mukta',sans-serif;transition:background 0.15s}
.prof-banner-edit:hover{background:rgba(0,0,0,0.7)}
.prof-av-wrap{position:absolute;bottom:-36px;left:50%;transform:translateX(-50%)}
.prof-av-outer{width:72px;height:72px;border-radius:50%;border:4px solid var(--card);background:var(--cream2);position:relative;overflow:hidden;cursor:pointer;transition:transform 0.2s}
.prof-av-outer:hover{transform:scale(1.04)}
.prof-av-outer img{width:100%;height:100%;object-fit:cover}
.prof-av-initials{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:'Yatra One',serif;font-size:1.5rem;color:var(--rust)}
.prof-av-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;color:#fff;font-size:0.65rem;text-align:center;border-radius:50%}
.prof-av-outer:hover .prof-av-overlay{display:flex}
.prof-info{padding:2.75rem 1.25rem 1.25rem;text-align:center}
.p-stats{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.ps-box{padding:0.75rem;text-align:center}
.ps-n{font-weight:700;font-size:1.05rem}
.ps-l{font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px}
.p-sec{padding:0.875rem 1.25rem;border-bottom:1px solid var(--border)}
.p-sec-t{font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:7px}
.sk-bar{margin-bottom:7px}
.sk-n{font-size:0.75rem;display:flex;justify-content:space-between;margin-bottom:3px}
.sk-track{height:4px;background:var(--cream2);border-radius:2px;overflow:hidden}
.sk-fill{height:100%;background:linear-gradient(90deg,var(--rust),var(--gold));border-radius:2px;transition:width 0.9s cubic-bezier(.22,1,.36,1)}

/* PORTFOLIO GRID */
.port-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:0.875rem}
.port-item{aspect-ratio:1;border-radius:7px;overflow:hidden;border:1.5px solid var(--border);background:var(--cream2);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;transition:all 0.2s}
.port-item:hover{border-color:var(--rust);transform:scale(1.02)}
.port-item img{width:100%;height:100%;object-fit:cover}
.port-item .pi-icon{font-family:'Yatra One',serif;font-size:2.2rem;color:var(--rust);opacity:0.35}
.port-item .pi-type{position:absolute;top:5px;left:5px;background:rgba(26,15,8,0.65);color:#fff;font-size:0.58rem;padding:2px 6px;border-radius:2px;font-weight:700;text-transform:uppercase}
.port-item .pi-label{position:absolute;bottom:0;left:0;right:0;background:rgba(26,15,8,0.7);color:#fff;font-size:0.68rem;padding:4px 7px;font-weight:600}
.port-add{border:2px dashed var(--border);cursor:pointer;flex-direction:column;gap:3px;font-size:0.72rem;color:var(--muted);transition:all 0.2s}
.port-add:hover{border-color:var(--rust);color:var(--rust)}

/* FORM STEPS */
.step-ind{display:flex;gap:4px;margin-bottom:1.25rem}
.step-dot{flex:1;height:3px;background:var(--border);border-radius:2px;transition:all 0.3s}
.step-dot.done{background:var(--rust)}.step-dot.cur{background:var(--gold)}
.form-step{display:none}.form-step.act{display:block;animation:fadeIn 0.3s}
.form-nav{display:flex;justify-content:space-between;margin-top:1rem;padding-top:0.875rem;border-top:1px solid var(--border)}
.rp-btn{border:1.5px solid var(--border);background:var(--card);color:var(--muted);font-size:0.72rem;padding:4px 12px;border-radius:14px;cursor:pointer;font-family:'Mukta',sans-serif;transition:all 0.15s;font-weight:500}
.rp-btn:hover{border-color:var(--rust);color:var(--rust)}
.rp-btn.sel{background:var(--rust);color:#fff;border-color:var(--rust)}
.role-pick{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}

/* OVERLAY */
.overlay{position:fixed;inset:0;background:rgba(26,15,8,0.7);display:flex;align-items:center;justify-content:center;z-index:200;padding:1rem;backdrop-filter:blur(3px)}
.modal{background:var(--card);border-radius:12px;width:100%;max-width:470px;overflow:hidden;animation:fadeUp 0.3s cubic-bezier(.22,1,.36,1)}
.modal-hd{background:var(--ink);padding:1.35rem 1.5rem;color:#fff;position:relative}
.modal-hd::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--rust),var(--gold))}
.modal-hd h3{font-family:'Yatra One',serif;color:var(--gold);font-size:1.12rem}
.modal-hd p{font-size:0.75rem;color:rgba(255,255,255,0.55);margin-top:3px}
.modal-body{padding:1.35rem;max-height:65vh;overflow-y:auto}
.modal-foot{padding:0.875rem 1.35rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}
.tkt-tier{border:1.5px solid var(--border);border-radius:7px;padding:10px 13px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s}
.tkt-tier:hover,.tkt-tier.sel{border-color:var(--rust);background:var(--rust-light)}
.tkt-tier-n{font-weight:700;font-size:0.87rem}
.tkt-tier-d{font-size:0.72rem;color:var(--muted)}
.tkt-price{font-weight:700;color:var(--rust);font-size:0.92rem}

/* NOTIF */
.notif-item{display:flex;gap:10px;padding:0.875rem 1rem;border-bottom:1px solid var(--border);background:var(--card);cursor:pointer;transition:background 0.1s}
.notif-item:hover{background:var(--cream2)}
.notif-item.unr{background:#FFFAF2}
.n-dot{width:7px;height:7px;border-radius:50%;background:var(--rust);margin-top:5px;flex-shrink:0}
.n-dot.r{background:transparent;border:1px solid var(--border)}
.n-av{width:34px;height:34px;border-radius:50%;background:var(--cream2);display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:var(--rust);flex-shrink:0}

/* TOAST */
#toast{position:fixed;bottom:1.75rem;right:1.75rem;background:var(--ink);color:#fff;padding:11px 18px;border-radius:7px;font-size:0.83rem;z-index:300;opacity:0;transform:translateY(8px);transition:all 0.3s;pointer-events:none;border-left:3px solid var(--gold);max-width:320px}
#toast.show{opacity:1;transform:translateY(0)}

/* REVEAL */
.reveal{opacity:0;transform:translateY(14px);transition:opacity 0.5s ease,transform 0.5s ease}
.reveal.vis{opacity:1;transform:translateY(0)}

/* PHOTO UPLOAD */
.photo-upload-zone{border:2px dashed var(--border);border-radius:8px;padding:1.5rem;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--cream)}
.photo-upload-zone:hover{border-color:var(--rust);background:var(--rust-light)}
.photo-upload-zone input{display:none}
.photo-preview{width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 8px;display:block;border:3px solid var(--rust)}

@media(max-width:900px){
  .hero-inner{grid-template-columns:1fr}
  .prof-wrap{grid-template-columns:1fr}
  .msg-layout{grid-template-columns:1fr;height:auto}
  .pi{padding:1rem}
  .hero-inner{padding:2rem 1rem}
}
</style>
</head>
<body>
<canvas id="fc"></canvas>

<!-- AUTH -->
<div id="auth-screen">
  <svg class="auth-mandala" style="top:-120px;left:-120px;width:550px;height:550px;animation:spin 90s linear infinite" viewBox="0 0 200 200" fill="none">
    <g stroke="#C9922A" stroke-width="0.4" opacity="0.9">
      <circle cx="100" cy="100" r="95"/><circle cx="100" cy="100" r="75"/><circle cx="100" cy="100" r="55"/><circle cx="100" cy="100" r="35"/><circle cx="100" cy="100" r="15"/>
      <line x1="100" y1="5" x2="100" y2="195"/><line x1="5" y1="100" x2="195" y2="100"/>
      <line x1="32" y1="32" x2="168" y2="168"/><line x1="168" y1="32" x2="32" y2="168"/>
      <line x1="67" y1="6" x2="133" y2="194"/><line x1="6" y1="67" x2="194" y2="133"/><line x1="133" y1="6" x2="67" y2="194"/><line x1="6" y1="133" x2="194" y2="67"/>
    </g>
    <g fill="#C9922A" opacity="0.7">
      <circle cx="100" cy="5" r="3"/><circle cx="100" cy="195" r="3"/>
      <circle cx="5" cy="100" r="3"/><circle cx="195" cy="100" r="3"/>
      <circle cx="32" cy="32" r="2.5"/><circle cx="168" cy="32" r="2.5"/>
      <circle cx="32" cy="168" r="2.5"/><circle cx="168" cy="168" r="2.5"/>
    </g>
  </svg>
  <svg class="auth-mandala" style="bottom:-80px;right:-80px;width:380px;height:380px;animation:spin 70s linear infinite reverse" viewBox="0 0 200 200" fill="none">
    <g stroke="#B8432F" stroke-width="0.5" opacity="0.7">
      <circle cx="100" cy="100" r="90"/><circle cx="100" cy="100" r="60"/><circle cx="100" cy="100" r="30"/>
      <line x1="100" y1="10" x2="100" y2="190"/><line x1="10" y1="100" x2="190" y2="100"/>
      <line x1="29" y1="29" x2="171" y2="171"/><line x1="171" y1="29" x2="29" y2="171"/>
    </g>
  </svg>
  <div class="auth-box">
    <div class="auth-header">
      <span class="auth-logo yatra">कलाचौतारी</span>
      <div class="auth-sub">Nepali Creative Hub</div>
    </div>
    <div class="auth-tabs">
      <button class="auth-tab act" onclick="switchAuth('login')">Sign In</button>
      <button class="auth-tab" onclick="switchAuth('register')">Join Now</button>
    </div>
    <div id="auth-login" class="auth-form act">
      <div class="auth-err" id="login-err"></div>
      <div class="fgrp"><label class="flbl">Email</label><input class="finp" id="login-email" type="email" placeholder="your@email.com"/></div>
      <div class="fgrp"><label class="flbl">Password</label><input class="finp" id="login-pw" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')doLogin()"/></div>
      <button class="btn-p" style="width:100%" onclick="doLogin()">Sign In</button>
      <div class="demo-hint">Demo: aasha@demo.com / demo1234</div>
    </div>
    <div id="auth-register" class="auth-form">
      <div class="auth-err" id="reg-err"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="fgrp"><label class="flbl">Full Name</label><input class="finp" id="reg-name" placeholder="Aasha Gurung"/></div>
        <div class="fgrp"><label class="flbl">Email</label><input class="finp" id="reg-email" type="email" placeholder="email"/></div>
      </div>
      <div class="fgrp"><label class="flbl">Password</label><input class="finp" id="reg-pw" type="password" placeholder="Min 6 characters"/></div>
      <div class="fgrp"><label class="flbl">Your Role</label><input class="finp" id="reg-role" placeholder="Singer, Filmmaker, Poet..."/></div>
      <div class="fgrp"><label class="flbl">Location</label><input class="finp" id="reg-loc" placeholder="Kathmandu / London / Sydney..."/></div>
      <div class="fgrp"><label class="flbl">Disciplines</label>
        <div class="role-pick" id="reg-disc">
          <button class="rp-btn" onclick="toggleRP(this)">Musician</button><button class="rp-btn" onclick="toggleRP(this)">Filmmaker</button>
          <button class="rp-btn" onclick="toggleRP(this)">Writer</button><button class="rp-btn" onclick="toggleRP(this)">Visual Artist</button>
          <button class="rp-btn" onclick="toggleRP(this)">Dancer</button><button class="rp-btn" onclick="toggleRP(this)">Poet</button>
        </div>
      </div>
      <button class="btn-p" style="width:100%;margin-top:0.5rem" onclick="doRegister()">Create Account</button>
    </div>
  </div>
</div>

<!-- APP -->
<div id="app">
  <div id="nav">
    <div class="nav-gold-line"></div>
    <a class="logo" href="#" onclick="goPage('projects')">
      <div class="logo-icon yatra">क</div>
      <div>
        <div class="logo-txt yatra">Kalachautari</div>
        <div class="logo-sub">Nepali Creative Hub</div>
      </div>
    </a>
    <button class="nav-btn" data-p="projects"><span class="en-t">Projects</span><span class="np-t np">परियोजना</span></button>
    <button class="nav-btn" data-p="discover"><span class="en-t">Creatives</span><span class="np-t np">कलाकार</span></button>
    <button class="nav-btn" data-p="match"><span class="en-t">Match</span><span class="np-t np">मेल</span></button>
    <button class="nav-btn" data-p="forum"><span class="en-t">Forum</span><span class="np-t np">मञ्च</span></button>
    <button class="nav-btn" data-p="events"><span class="en-t">Events</span><span class="np-t np">कार्यक्रम</span></button>
    <button class="nav-btn" data-p="messages"><span class="en-t">Messages</span><span class="np-t np">सन्देश</span><span class="nbadge" id="msg-badge" style="display:none">0</span></button>
    <button class="nav-btn" data-p="notifs"><span class="en-t">Notifications</span><span class="np-t np">सूचना</span><span class="nbadge" id="notif-badge" style="display:none">0</span></button>
    <button class="nav-btn" data-p="profile"><span class="en-t">Profile</span><span class="np-t np">प्रोफाइल</span></button>
    <div class="lang-tog">
      <button class="lng act" onclick="setLang('en')">EN</button>
      <button class="lng" onclick="setLang('np')">ने</button>
    </div>
    <div class="nav-av" id="nav-av" onclick="goPage('profile')" style="margin-left:8px"></div>
    <button class="btn-sm" onclick="doLogout()" style="color:rgba(255,255,255,0.4);border-color:rgba(255,255,255,0.1);font-size:0.68rem;margin-left:6px">Logout</button>
  </div>

  <!-- PROJECTS PAGE -->
  <div id="p-projects" class="page">
    <div class="hero dhaka">
      <div class="hero-bg-lines"></div>
      <div class="hero-mandala-wrap">
        <svg viewBox="0 0 200 200" fill="none">
          <g stroke="#C9922A" stroke-width="0.5">
            <circle cx="100" cy="100" r="95"/><circle cx="100" cy="100" r="75"/><circle cx="100" cy="100" r="55"/><circle cx="100" cy="100" r="35"/><circle cx="100" cy="100" r="15"/>
            <line x1="100" y1="5" x2="100" y2="195"/><line x1="5" y1="100" x2="195" y2="100"/>
            <line x1="32" y1="32" x2="168" y2="168"/><line x1="168" y1="32" x2="32" y2="168"/>
            <line x1="67" y1="6" x2="133" y2="194"/><line x1="6" y1="67" x2="194" y2="133"/>
            <line x1="133" y1="6" x2="67" y2="194"/><line x1="6" y1="133" x2="194" y2="67"/>
          </g>
          <g fill="#C9922A"><circle cx="100" cy="5" r="3"/><circle cx="100" cy="195" r="3"/><circle cx="5" cy="100" r="3"/><circle cx="195" cy="100" r="3"/><circle cx="32" cy="32" r="2.5"/><circle cx="168" cy="32" r="2.5"/><circle cx="32" cy="168" r="2.5"/><circle cx="168" cy="168" r="2.5"/></g>
        </svg>
      </div>
      <div class="hero-inner">
        <div>
          <div class="hero-badge fade-up">
            <span class="en-t">Open Collaborations</span>
            <span class="np-t np">खुला सहकार्यहरू</span>
          </div>
          <h1 class="fade-up-1">
            <span class="en-t">Find your next <em>creative project</em></span>
            <span class="np-t np">आफ्नो <em>सिर्जनात्मक परियोजना</em> खोज्नुस्</span>
          </h1>
          <p class="hero-sub fade-up-2 en-t">Browse open projects. Apply to collaborate. Or post your own and find your tabla player, director, poet — from anywhere in the world.</p>
          <p class="hero-sub fade-up-2 np-t np">खुला परियोजनाहरू हेर्नुस्। सहकार्यका लागि आवेदन दिनुस्। वा आफ्नो परियोजना राख्नुस्।</p>
          <div class="hero-btns fade-up-3">
            <button class="btn-p" onclick="goPage('post-project')">+ <span class="en-t">Post a Project</span><span class="np-t np">परियोजना राख्नुस्</span></button>
            <button class="btn-o" style="color:#fff;border-color:rgba(255,255,255,0.28)" onclick="goPage('discover')"><span class="en-t">Browse Creatives</span><span class="np-t np">कलाकारहरू हेर्नुस्</span></button>
          </div>
        </div>
        <div class="stat-grid fade-up-2">
          <div class="stat-box"><span class="ornament">♪</span><span class="stat-n" id="stat-projects">—</span><div class="stat-l en-t">Projects</div><div class="stat-l np-t np">परियोजना</div></div>
          <div class="stat-box"><span class="ornament">✦</span><span class="stat-n" id="stat-users">—</span><div class="stat-l en-t">Creatives</div><div class="stat-l np-t np">कलाकार</div></div>
          <div class="stat-box"><span class="ornament">◉</span><span class="stat-n" id="stat-events">—</span><div class="stat-l en-t">Events</div><div class="stat-l np-t np">कार्यक्रम</div></div>
        </div>
      </div>
    </div>
    <div class="pi">
      <div class="fbar" style="margin-top:1.5rem">
        <input class="srch" id="proj-search" placeholder="Search projects…" oninput="loadProjects()"/>
        <button class="fpill act" onclick="setProjFilter(this,'')">All</button>
        <button class="fpill" onclick="setProjFilter(this,'Music')">Music</button>
        <button class="fpill" onclick="setProjFilter(this,'Film')">Film</button>
        <button class="fpill" onclick="setProjFilter(this,'Literature')">Literature</button>
        <button class="fpill" onclick="setProjFilter(this,'Visual Art')">Visual Art</button>
        <button class="fpill" onclick="setProjFilter(this,'Dance')">Dance</button>
        <button class="fpill" onclick="setProjFilter(this,'remote')">Remote OK</button>
      </div>
      <div class="g2" id="projects-grid"><div style="color:var(--muted);padding:2rem;text-align:center">Loading projects...</div></div>
    </div>
  </div>

  <!-- DISCOVER -->
  <div id="p-discover" class="page">
    <div class="hero dhaka" style="padding:0">
      <div class="hero-bg-lines"></div>
      <div class="hero-inner" style="grid-template-columns:1fr;text-align:center;padding:2.5rem 2rem">
        <div class="fade-up">
          <div class="hero-badge" style="margin:0 auto 0.875rem">Creative Community</div>
          <h1><span class="en-t">Meet <em>Nepali creatives</em> worldwide</span><span class="np-t np">विश्वभरका <em>नेपाली कलाकारहरू</em> भेट्नुस्</span></h1>
          <p class="hero-sub" style="margin:0.625rem auto 0;max-width:480px">Musicians, filmmakers, writers, visual artists and dancers — in Nepal and the diaspora.</p>
        </div>
      </div>
    </div>
    <div class="pi">
      <div class="fbar" style="margin-top:1.5rem">
        <input class="srch" id="creator-search" placeholder="Search name, skill…" oninput="loadCreators()"/>
        <button class="fpill act" onclick="setTypeFilter(this,'')">All</button>
        <button class="fpill" onclick="setTypeFilter(this,'musician')">Musicians</button>
        <button class="fpill" onclick="setTypeFilter(this,'filmmaker')">Filmmakers</button>
        <button class="fpill" onclick="setTypeFilter(this,'writer')">Writers</button>
        <button class="fpill" onclick="setTypeFilter(this,'visual')">Visual Artists</button>
        <button class="fpill" onclick="setTypeFilter(this,'dancer')">Dancers</button>
      </div>
      <div class="g3" id="creators-grid"><div style="color:var(--muted);padding:2rem;text-align:center">Loading creatives...</div></div>
    </div>
  </div>

  <!-- MATCH -->
  <div id="p-match" class="page">
    <div class="pi">
      <div class="stitle yatra fade-up" style="padding-top:1rem"><span class="orn">✦</span><span class="en-t">Find Your Collaborator</span><span class="np-t np">सहयोगी खोज्नुस्</span></div>
      <div style="display:grid;grid-template-columns:1fr 300px;gap:1.5rem;align-items:start">
        <div>
          <div style="background:var(--cream2);border:1px solid var(--border);border-radius:7px;padding:0.875rem;margin-bottom:1rem;font-size:0.78rem;color:var(--muted)">Pass ✕ or Connect ✓. Mutual connects unlock messaging. ★ Super Connect notifies them instantly.</div>
          <div class="swipe-stack" id="swipe-stack"></div>
          <div class="sw-actions" style="margin-top:1rem">
            <button class="sw-btn pass" onclick="swipe('left')">✕</button>
            <button class="sw-btn star" onclick="swipe('super')">★</button>
            <button class="sw-btn conn" onclick="swipe('right')">✓</button>
          </div>
          <div id="match-pop-wrap" style="display:none;margin-top:1rem">
            <div class="match-pop"><div class="mp-t yatra">सञ्जोग भयो!</div>
              <div style="font-size:0.82rem;color:rgba(255,255,255,0.7);margin-bottom:1rem">It's a match! You can now message each other.</div>
              <div style="display:flex;justify-content:center;gap:8px">
                <button class="btn-p" id="match-msg-btn">Send Message</button>
                <button class="btn-o" style="color:rgba(255,255,255,0.7);border-color:rgba(255,255,255,0.2)" onclick="document.getElementById('match-pop-wrap').style.display='none'">Keep Browsing</button>
              </div>
            </div>
          </div>
        </div>
        <div style="background:var(--card);border:1.5px solid var(--border);border-radius:10px;padding:1rem">
          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.875rem">Recent Connects</div>
          <div id="recent-connects"><div style="font-size:0.75rem;color:var(--muted)">No connects yet</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- FORUM -->
  <div id="p-forum" class="page">
    <div class="hero dhaka" style="padding:0">
      <div class="hero-bg-lines"></div>
      <div class="hero-inner" style="grid-template-columns:1fr;text-align:center;padding:2.5rem 2rem">
        <div class="fade-up">
          <div class="hero-badge" style="margin:0 auto 0.875rem">Community Forum</div>
          <h1><span class="en-t">Share. <em>Inspire.</em> Discuss.</span><span class="np-t np">साझा गर्नुस्। <em>प्रेरित गर्नुस्।</em></span></h1>
          <p class="hero-sub" style="margin:0.625rem auto 0;max-width:480px">Share your work, post inspirations, ask questions, celebrate your collabs.</p>
        </div>
      </div>
    </div>
    <div class="pi">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:1.25rem 0 1rem">
        <div class="fbar" style="margin:0">
          <button class="fpill act" onclick="setForumFilter(this,'all')">All</button>
          <button class="fpill" onclick="setForumFilter(this,'music')">Music</button>
          <button class="fpill" onclick="setForumFilter(this,'film')">Film</button>
          <button class="fpill" onclick="setForumFilter(this,'art')">Art</button>
          <button class="fpill" onclick="setForumFilter(this,'inspo')">Inspiration</button>
          <button class="fpill" onclick="setForumFilter(this,'general')">General</button>
        </div>
        <button class="btn-p" onclick="showNewPost()">+ New Post</button>
      </div>
      <div id="forum-grid" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>
  </div>

  <!-- EVENTS -->
  <div id="p-events" class="page">
    <div class="pi">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;padding-top:1.25rem">
        <div class="stitle yatra fade-up" style="margin:0;flex:1"><span class="orn">✦</span><span class="en-t">Upcoming Events</span><span class="np-t np">आगामी कार्यक्रमहरू</span></div>
        <button class="btn-p" onclick="showCreateEvent()">+ Create Event</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px" id="events-list"></div>
    </div>
  </div>

  <!-- MESSAGES -->
  <div id="p-messages" class="page">
    <div class="pi">
      <div class="stitle yatra" style="padding-top:1.25rem"><span class="orn">✦</span><span class="en-t">Messages</span><span class="np-t np">सन्देशहरू</span></div>
      <div class="msg-wrap">
        <div class="msg-layout">
          <div class="conv-list">
            <div class="conv-hd"><span>Conversations</span><button class="btn-sm" onclick="showNewConvModal()" style="padding:2px 7px;font-size:0.65rem">+ New</button></div>
            <div id="conv-items"><div style="padding:1rem;font-size:0.78rem;color:var(--muted)">Loading...</div></div>
          </div>
          <div class="chat-main" id="chat-area">
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:var(--muted);gap:10px;padding:2rem">
              <div style="font-size:3.5rem;opacity:0.12;font-family:'Yatra One',serif">क</div>
              <div style="font-size:0.85rem">Select a conversation to start</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- NOTIFS -->
  <div id="p-notifs" class="page">
    <div class="pi">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;padding-top:1.25rem">
        <div class="stitle yatra" style="margin:0"><span class="orn">✦</span><span class="en-t">Notifications</span><span class="np-t np">सूचनाहरू</span></div>
        <button class="btn-sm" onclick="markAllRead()">Mark all read</button>
      </div>
      <div id="notif-list" style="border:1.5px solid var(--border);border-radius:10px;overflow:hidden"></div>
    </div>
  </div>

  <!-- PROFILE -->
  <div id="p-profile" class="page">
    <div class="pi" style="padding-top:1.75rem">
      <div class="prof-wrap">
        <div class="prof-side">
          <div class="prof-banner rust" id="prof-banner">
            <div class="prof-banner-pat"></div>
            <div class="prof-av-wrap">
              <div class="prof-av-outer" id="prof-av-outer" onclick="triggerPhotoUpload()">
                <div class="prof-av-initials" id="prof-av-initials">आ</div>
                <div class="prof-av-overlay">📷<br>Change</div>
              </div>
            </div>
            <button class="prof-banner-edit" onclick="triggerBannerUpload()">Change Banner</button>
          </div>
          <input type="file" id="photo-input" accept="image/*" style="display:none" onchange="handlePhotoUpload(this)"/>
          <input type="file" id="banner-input" accept="image/*" style="display:none" onchange="handleBannerUpload(this)"/>
          <div class="prof-info">
            <div style="font-weight:700;font-size:1.05rem;margin-bottom:2px" id="prof-name">—</div>
            <div style="font-size:0.72rem;color:var(--rust);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px" id="prof-role">—</div>
            <div style="font-size:0.78rem;color:var(--muted);line-height:1.45;margin-bottom:0.875rem" id="prof-bio"></div>
            <div class="p-stats">
              <div class="ps-box"><div class="ps-n" id="prof-stat-proj">0</div><div class="ps-l">Projects</div></div>
              <div class="ps-box"><div class="ps-n" id="prof-stat-exp">0</div><div class="ps-l">Yrs Exp</div></div>
              <div class="ps-box"><div class="ps-n" id="prof-stat-loc" style="font-size:0.78rem">—</div><div class="ps-l">Based</div></div>
            </div>
          </div>
          <div class="p-sec"><div class="p-sec-t">Skills</div><div id="prof-skills"></div></div>
          <div class="p-sec"><div class="p-sec-t">Genres</div><div id="prof-genres" style="display:flex;flex-wrap:wrap;gap:4px"></div></div>
          <div class="p-sec"><div class="p-sec-t">Location</div><div style="font-size:0.8rem;color:var(--muted)" id="prof-location">—</div></div>
          <div style="padding:0.875rem 1.25rem;display:flex;flex-direction:column;gap:7px">
            <button class="btn-p" onclick="showEditProfile()">Edit Profile</button>
            <button class="btn-o" onclick="doLogout()">Logout</button>
          </div>
        </div>
        <div>
          <!-- PORTFOLIO -->
          <div class="stitle yatra"><span class="orn">✦</span>Portfolio</div>
          <div class="port-grid" id="port-grid"></div>
          <button class="btn-o" style="margin-bottom:1.75rem;font-size:0.78rem" onclick="showAddPortfolio()">+ Add Portfolio Item</button>
          <!-- MY PROJECTS -->
          <div class="stitle yatra"><span class="orn">✦</span>My Projects</div>
          <div id="my-projects-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:1.75rem"></div>
          <!-- COLLAB HISTORY -->
          <div class="stitle yatra"><span class="orn">✦</span>Collaboration History</div>
          <div id="collab-history" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- POST PROJECT -->
  <div id="p-post-project" class="page">
    <div class="pi">
      <div style="max-width:590px;margin:1.25rem auto">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:1rem">
          <button class="btn-sm" onclick="goPage('projects')">← Back</button>
          <div class="stitle yatra" style="margin:0"><span class="en-t">Post a New Project</span><span class="np-t np">नयाँ परियोजना</span></div>
        </div>
        <div class="step-ind" id="pf-si"><div class="step-dot cur"></div><div class="step-dot"></div><div class="step-dot"></div><div class="step-dot"></div></div>
        <div style="background:var(--card);border:1.5px solid var(--border);border-radius:10px;padding:1.5rem">
          <div class="form-step act" id="pfs1">
            <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.875rem">Step 1 — Basic Info</div>
            <div class="fgrp"><label class="flbl">Project Title *</label><input class="finp" id="pf-title" placeholder="e.g. Himalaya EP, Bato Short Film"/></div>
            <div class="fgrp"><label class="flbl">Nepali Title (optional)</label><input class="finp" id="pf-title-np" placeholder="हिमालय EP"/></div>
            <div class="fgrp"><label class="flbl">Type *</label><select class="finp" id="pf-type"><option value="">Select type...</option><option>Music</option><option>Film</option><option>Literature</option><option>Visual Art</option><option>Dance</option><option>Multi-disciplinary</option></select></div>
            <div class="fgrp"><label class="flbl">Description *</label><textarea class="finp" id="pf-desc" style="height:90px" placeholder="What is this project about?"></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="fgrp"><label class="flbl">Timeline</label><select class="finp" id="pf-timeline"><option>1–4 weeks</option><option>1–3 months</option><option>3–6 months</option><option>Ongoing</option></select></div>
              <div class="fgrp"><label class="flbl">Location</label><input class="finp" id="pf-location" placeholder="Kathmandu / Remote"/></div>
            </div>
            <div class="fgrp" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pf-remote" checked/><label for="pf-remote" style="font-size:0.82rem">Remote collaboration welcome</label></div>
            <div class="form-nav"><div></div><button class="btn-p" onclick="pfNext(2)">Next →</button></div>
          </div>
          <div class="form-step" id="pfs2">
            <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.875rem">Step 2 — Roles Needed</div>
            <div class="fgrp"><label class="flbl">Select roles you need</label>
              <div class="role-pick" id="pf-roles">
                <button class="rp-btn" onclick="toggleRP(this)">Vocalist</button><button class="rp-btn" onclick="toggleRP(this)">Guitarist</button>
                <button class="rp-btn" onclick="toggleRP(this)">Tabla Player</button><button class="rp-btn" onclick="toggleRP(this)">Drummer</button>
                <button class="rp-btn" onclick="toggleRP(this)">Bassist</button><button class="rp-btn" onclick="toggleRP(this)">Keyboard</button>
                <button class="rp-btn" onclick="toggleRP(this)">Music Producer</button><button class="rp-btn" onclick="toggleRP(this)">Mixing Engineer</button>
                <button class="rp-btn" onclick="toggleRP(this)">Cinematographer</button><button class="rp-btn" onclick="toggleRP(this)">Video Editor</button>
                <button class="rp-btn" onclick="toggleRP(this)">Sound Designer</button><button class="rp-btn" onclick="toggleRP(this)">Actor</button>
                <button class="rp-btn" onclick="toggleRP(this)">Choreographer</button><button class="rp-btn" onclick="toggleRP(this)">Illustrator</button>
                <button class="rp-btn" onclick="toggleRP(this)">Photographer</button><button class="rp-btn" onclick="toggleRP(this)">Writer / Lyricist</button>
                <button class="rp-btn" onclick="toggleRP(this)">Poet</button><button class="rp-btn" onclick="toggleRP(this)">Translator</button>
              </div>
            </div>
            <div class="fgrp"><label class="flbl">Experience Required</label><select class="finp" id="pf-exp"><option>Any level</option><option>Beginner friendly</option><option>Intermediate+</option><option>Expert only</option></select></div>
            <div class="form-nav"><button class="btn-o" onclick="pfNext(1)">← Back</button><button class="btn-p" onclick="pfNext(3)">Next →</button></div>
          </div>
          <div class="form-step" id="pfs3">
            <div style="font-size:0.68nm;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.875rem">Step 3 — Media & Links</div>
            <div class="fgrp"><label class="flbl">Reference Links</label><input class="finp" id="pf-link1" placeholder="SoundCloud, YouTube, Behance..." style="margin-bottom:5px"/><input class="finp" id="pf-link2" placeholder="Additional link..."/></div>
            <div class="fgrp"><label class="flbl">Cover Image URL</label><input class="finp" id="pf-cover" placeholder="https://..."/></div>
            <div class="form-nav"><button class="btn-o" onclick="pfNext(2)">← Back</button><button class="btn-p" onclick="pfNext(4)">Next →</button></div>
          </div>
          <div class="form-step" id="pfs4">
            <div style="font-size:0.68nm;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.875rem">Step 4 — Review & Publish</div>
            <div id="pf-preview" style="background:var(--cream2);border-radius:6px;padding:1rem;margin-bottom:0.875rem"></div>
            <div style="background:var(--gold-light);border:1px solid rgba(201,146,42,0.3);border-radius:5px;padding:0.75rem;font-size:0.78rem;color:var(--gold2);margin-bottom:0.875rem">Once published, interested collaborators can apply. You'll receive an instant notification.</div>
            <div class="form-nav"><button class="btn-o" onclick="pfNext(3)">← Back</button><button class="btn-p" id="publish-btn" onclick="publishProject()">Publish Project</button></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="overlay" id="overlay" style="display:none" onclick="closeOverlay(event)">
  <div class="modal" id="modal-content" onclick="event.stopPropagation()"></div>
</div>
<div id="toast"></div>

<script>
const S={
  token:localStorage.getItem('kc_token'),
  user:JSON.parse(localStorage.getItem('kc_user')||'null'),
  lang:localStorage.getItem('kc_lang')||'en',
  currentConv:null,swipeCandidates:[],swipeIdx:0,recentConnects:[],
  pfStep:1,ws:null,projFilter:'',typeFilter:'',forumFilter:'all',
  portfolio:JSON.parse(localStorage.getItem('kc_portfolio')||'[]'),
  photoUrl:localStorage.getItem('kc_photo')||'',
  forumPosts:[
    {id:'f1',author:'Aasha Gurung',init:'आ',color:'rust',cat:'music',title:'Sharing my demo — Himalaya EP rough cut',body:'Been working on this folk fusion EP for 6 months. Finally have a rough mix of the first track. Would love feedback from other musicians on the arrangement!',link:'',likes:14,comments:7,time:'2 hours ago'},
    {id:'f2',author:'Bikash Magar',init:'बि',color:'blue',cat:'film',title:'Films that shaped my storytelling',body:'Growing up watching Lagaan and Taare Zameen Par completely changed how I think about narrative. What films have inspired you? Let\\'s build a collective list.',likes:23,comments:12,time:'5 hours ago'},
    {id:'f3',author:'Mira Thapa',init:'मी',color:'gold',cat:'inspo',title:'Poem for the diaspora — "Ghar"',body:'I wrote this while sitting in London missing the smell of rain on Kathmandu streets. Would love to create a collective poetry thread here.',likes:31,comments:18,time:'Yesterday'},
    {id:'f4',author:'Anita Lama',init:'अ',color:'green',cat:'art',title:'Thangka meets street art — work in progress',body:'Been experimenting with combining traditional Thangka motifs with contemporary street art aesthetics. Posting some sketches and would love feedback.',likes:19,comments:9,time:'2 days ago'},
    {id:'f5',author:'Sujen Rai',init:'सु',color:'rust',cat:'general',title:'Remote collab tools that actually work',body:'After collaborating with people across 3 time zones on the Himalaya EP, here are the tools that saved us: Splice, Notion, and a solid shared Google Drive.',likes:42,comments:21,time:'3 days ago'},
  ]
};

const API=window.location.origin;

// ── CANVAS ─────────────────────────────────────────────────────────────────
(function initCanvas(){
  const c=document.getElementById('fc');
  if(!c)return;
  const ctx=c.getContext('2d');
  c.width=window.innerWidth;c.height=window.innerHeight;
  const chars='कखगघचछजझटठडढतथदधनपफबभमयरलवशषसह'.split('');
  const ps=Array.from({length:22},()=>({
    x:Math.random()*c.width,y:Math.random()*c.height,
    ch:chars[Math.floor(Math.random()*chars.length)],
    sz:10+Math.random()*18,sp:0.15+Math.random()*0.4,
    op:0.03+Math.random()*0.07,dr:(Math.random()-0.5)*0.25
  }));
  (function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ps.forEach(p=>{
      ctx.font=p.sz+'px "Yatra One",serif';
      ctx.fillStyle='rgba(201,146,42,'+p.op+')';
      ctx.fillText(p.ch,p.x,p.y);
      p.y-=p.sp;p.x+=p.dr;
      if(p.y<-40){p.y=c.height+20;p.x=Math.random()*c.width;}
    });
    requestAnimationFrame(draw);
  })();
  window.addEventListener('resize',()=>{c.width=window.innerWidth;c.height=window.innerHeight;});
})();

// ── HELPERS ─────────────────────────────────────────────────────────────────
async function api(path,opts={}){
  const h={'Content-Type':'application/json'};
  if(S.token)h['Authorization']='Bearer '+S.token;
  const r=await fetch(API+'/api'+path,{headers:h,...opts,body:opts.body?JSON.stringify(opts.body):undefined});
  if(r.status===401){doLogout();return null;}
  return r.json();
}
function toast(msg,d=3500){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),d);
}
function fmtTime(iso){
  if(!iso)return'';
  const d=new Date(iso),now=new Date(),diff=Math.floor((now-d)/1000);
  if(diff<60)return'just now';if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return d.toLocaleDateString();
}
function toggleRP(b){b.classList.toggle('sel')}
function showModal(h){document.getElementById('modal-content').innerHTML=h;document.getElementById('overlay').style.display='flex';}
function closeOverlay(e){if(!e||e.target===document.getElementById('overlay'))document.getElementById('overlay').style.display='none';}
function setLang(l){S.lang=l;localStorage.setItem('kc_lang',l);document.body.classList.toggle('nepali',l==='np');document.querySelectorAll('.lng').forEach(b=>b.classList.toggle('act',b.textContent.trim()===(l==='en'?'EN':'ने')));}
setLang(S.lang);

function initReveal(){
  document.querySelectorAll('.reveal').forEach(el=>{
    const ob=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('vis');ob.unobserve(e.target);}});},{threshold:0.1});
    ob.observe(el);
  });
}

// ── AUTH ─────────────────────────────────────────────────────────────────────
function switchAuth(tab){
  document.querySelectorAll('.auth-tab').forEach((b,i)=>b.classList.toggle('act',(i===0)===(tab==='login')));
  document.getElementById('auth-login').classList.toggle('act',tab==='login');
  document.getElementById('auth-register').classList.toggle('act',tab==='register');
}
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-pw').value;
  document.getElementById('login-err').textContent='';
  if(!email||!pw)return document.getElementById('login-err').textContent='Fill in all fields';
  const res=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})});
  const data=await res.json();
  if(!res.ok)return document.getElementById('login-err').textContent=data.error||'Login failed';
  loginSuccess(data.token,data.user);
}
async function doRegister(){
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pw=document.getElementById('reg-pw').value;
  const role=document.getElementById('reg-role').value.trim();
  const loc=document.getElementById('reg-loc').value.trim();
  const disciplines=[...document.querySelectorAll('#reg-disc .rp-btn.sel')].map(b=>b.textContent.trim().toLowerCase());
  document.getElementById('reg-err').textContent='';
  if(!name||!email||!pw)return document.getElementById('reg-err').textContent='Fill in all required fields';
  if(pw.length<6)return document.getElementById('reg-err').textContent='Password must be at least 6 characters';
  const res=await fetch(API+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pw,role,location:loc,disciplines})});
  const data=await res.json();
  if(!res.ok)return document.getElementById('reg-err').textContent=data.error||'Registration failed';
  loginSuccess(data.token,data.user);
}
function loginSuccess(token,user){
  S.token=token;S.user=user;
  localStorage.setItem('kc_token',token);
  localStorage.setItem('kc_user',JSON.stringify(user));
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='block';
  updateNavAv();
  connectWS();loadStats();loadProjects();loadNotifCount();
  setTimeout(initReveal,200);
}
function doLogout(){localStorage.removeItem('kc_token');localStorage.removeItem('kc_user');if(S.ws)S.ws.close();location.reload();}

function updateNavAv(){
  const el=document.getElementById('nav-av');
  if(!el)return;
  if(S.photoUrl){el.innerHTML=\`<img src="\${S.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>\`;el.style.background='none';}
  else{el.textContent=S.user?.avatar_init||S.user?.name?.charAt(0)||'?';el.style.background=colorMap(S.user?.avatar_color);}
}
function colorMap(c){const m={rust:'var(--rust)',blue:'var(--himalaya)',gold:'var(--gold)',green:'var(--green)'};return m[c]||'var(--rust)';}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────
function connectWS(){
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(\`\${proto}://\${location.host}/ws?token=\${S.token}\`);
  S.ws=ws;
  ws.onmessage=(e)=>{
    const{event,data}=JSON.parse(e.data);
    if(event==='message'&&S.currentConv===data.conv_id)appendMessage(data);
    if(event==='message')updateConvPreview(data.conv_id,data.content);
    if(event==='notification'){toast('🔔 '+data.title);loadNotifCount();}
    if(event==='new_interest'){toast(\`New interest: \${data.user_name} on "\${data.project_title}"\`);loadNotifCount();}
  };
  ws.onclose=()=>setTimeout(connectWS,3000);
}

// ── NAV ───────────────────────────────────────────────────────────────────
function goPage(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('act'));
  document.querySelectorAll('.nav-btn[data-p]').forEach(b=>b.classList.remove('act'));
  const pg=document.getElementById('p-'+p);if(pg)pg.classList.add('act');
  const nb=document.querySelector(\`.nav-btn[data-p="\${p}"]\`);if(nb)nb.classList.add('act');
  if(p==='projects')loadProjects();if(p==='discover')loadCreators();
  if(p==='events')loadEvents();if(p==='messages')loadConversations();
  if(p==='notifs')loadNotifications();if(p==='profile')loadProfile();
  if(p==='match')loadMatchCandidates();if(p==='forum')renderForum();
  if(p==='post-project'){S.pfStep=1;showPfStep(1);}
  setTimeout(initReveal,100);
}
document.querySelectorAll('.nav-btn[data-p]').forEach(b=>b.addEventListener('click',()=>goPage(b.dataset.p)));

// ── STATS ─────────────────────────────────────────────────────────────────
async function loadStats(){
  const[u,p,e]=await Promise.all([api('/users'),api('/projects'),api('/events')]);
  function anim(el,n){let c=0;const s=Math.ceil(n/30);const iv=setInterval(()=>{c=Math.min(c+s,n);el.textContent=c;if(c>=n)clearInterval(iv);},40);}
  if(u)anim(document.getElementById('stat-users'),u.length);
  if(p)anim(document.getElementById('stat-projects'),p.length);
  if(e)anim(document.getElementById('stat-events'),e.length);
}

// ── PROJECTS ──────────────────────────────────────────────────────────────
let pjFilter='',pjRemote=false;
function setProjFilter(btn,t){document.querySelectorAll('#p-projects .fpill').forEach(p=>p.classList.remove('act'));btn.classList.add('act');pjFilter=t==='remote'?'':t;pjRemote=t==='remote';loadProjects();}
async function loadProjects(){
  const q=new URLSearchParams();const s=document.getElementById('proj-search')?.value||'';
  if(pjFilter)q.set('type',pjFilter);if(pjRemote)q.set('remote','1');if(s)q.set('search',s);
  const ps=await api('/projects?'+q);if(!ps)return;
  const g=document.getElementById('projects-grid');
  if(!ps.length){g.innerHTML='<div style="color:var(--muted);padding:2.5rem;text-align:center;grid-column:1/-1">No projects found. <button class="btn-sm" onclick="goPage(\\'post-project\\')">Post the first one!</button></div>';return;}
  const tc={Music:'rust',Film:'blue',Literature:'green','Visual Art':'gold',Dance:'gold'};
  g.innerHTML=ps.map((p,i)=>\`
    <div class="card reveal" style="overflow:hidden">
      <div class="pc-head">
        <div>
          <div class="pc-title">\${p.title}</div>
          <div style="font-size:0.7rem;color:var(--muted)">\${p.location||''}\${p.remote_ok?' · Remote OK':''}</div>
        </div>
        <span class="tag \${tc[p.type]||''}">\${p.type}</span>
      </div>
      <div class="pc-body">
        <div class="pc-desc">\${(p.description||'').slice(0,150)}\${(p.description||'').length>150?'…':''}</div>
        <div style="margin-bottom:5px">
          <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--muted);margin-bottom:4px">Looking for</div>
          \${JSON.parse(p.roles_needed||'[]').map(r=>\`<span class="need">\${r}</span>\`).join('')}
        </div>
      </div>
      <div class="pc-foot">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="ow-av">\${ownerAvHtml(p)}</div>
          <span style="font-size:0.72rem;color:var(--muted)">\${p.owner_name}</span>
        </div>
        <span style="font-size:0.7rem;color:var(--muted)">\${p.interest_count||0} interested</span>
        \${p.owner_id===S.user?.id
          ?\`<button class="btn-sm" onclick="viewInterests('\${p.id}','\${esc(p.title)}')">View Interests</button>\`
          :\`<button class="btn-g" style="padding:4px 13px;font-size:0.72rem" onclick="showInterestModal('\${p.id}','\${esc(p.title)}')">I'm Interested</button>\`
        }
      </div>
    </div>\`).join('');
  setTimeout(initReveal,50);
}
function ownerAvHtml(p){
  // check if owner has a photo stored locally (they'd have to be the logged in user)
  if(p.owner_id===S.user?.id&&S.photoUrl)return\`<img src="\${S.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>\`;
  return p.owner_init||'?';
}
function esc(s){return(s||'').replace(/'/g,"\\\\'")}

// ── INTERESTS ─────────────────────────────────────────────────────────────
function showInterestModal(pid,pt){
  showModal(\`<div class="modal-hd"><h3>Express Interest</h3><p>Applying for: <strong>\${pt}</strong></p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Your Role Offer</label><input class="finp" id="int-role" placeholder="e.g. Tabla player, 8 years experience"/></div>
      <div class="fgrp"><label class="flbl">Message to Owner</label><textarea class="finp" id="int-msg" style="height:80px" placeholder="Tell them why you're a great fit…"></textarea></div>
      <div class="fgrp"><label class="flbl">Portfolio / Work Link</label><input class="finp" id="int-link" placeholder="https://soundcloud.com/..."/></div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="submitInterest('\${pid}')">Send Interest</button></div>\`);
}
async function submitInterest(pid){
  const res=await api(\`/projects/\${pid}/interest\`,{method:'POST',body:{role_offer:document.getElementById('int-role')?.value||'',message:document.getElementById('int-msg')?.value||'',portfolio_link:document.getElementById('int-link')?.value||''}});
  closeOverlay();if(res?.error)return toast('Error: '+res.error);
  toast('Interest sent! The project owner has been notified instantly.');loadProjects();
}
async function viewInterests(pid,pt){
  const is=await api(\`/projects/\${pid}/interests\`);if(!is)return;
  const rows=is.length?is.map(i=>\`
    <div style="background:var(--cream2);border-radius:7px;padding:10px 13px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;font-size:0.88rem">\${i.name}</div>
          <div style="font-size:0.72rem;color:var(--rust);margin-bottom:3px">\${i.role_offer||i.role||''}</div>
          <div style="font-size:0.77rem;color:var(--muted)">\${i.message||'(no message)'}</div>
          \${i.portfolio_link?\`<a href="\${i.portfolio_link}" target="_blank" style="font-size:0.7rem;color:var(--himalaya)">Portfolio →</a>\`:''}
        </div>
        <span class="tag \${i.status==='accepted'?'green':i.status==='declined'?'rust':''}">\${i.status}</span>
      </div>
      \${i.status==='pending'?\`<div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-p" style="font-size:0.72rem;padding:4px 13px" onclick="respondInterest('\${i.id}','accepted','\${pid}','\${esc(pt)}')">Accept</button>
        <button class="btn-sm" onclick="respondInterest('\${i.id}','declined','\${pid}','\${esc(pt)}')">Decline</button>
      </div>\`:''}
    </div>\`).join(''):'<div style="color:var(--muted);font-size:0.83rem">No interests yet.</div>';
  showModal(\`<div class="modal-hd"><h3>\${pt}</h3><p>\${is.length} application\${is.length!==1?'s':''}</p></div>
    <div class="modal-body">\${rows}</div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Close</button></div>\`);
}
async function respondInterest(iid,status,pid,pt){
  await api(\`/interests/\${iid}\`,{method:'PATCH',body:{status}});
  toast(status==='accepted'?'Accepted! A conversation has been created.':'Application declined.');
  closeOverlay();if(status==='accepted')setTimeout(()=>{goPage('messages');loadConversations();},500);
  else viewInterests(pid,pt);
}

// ── CREATORS ──────────────────────────────────────────────────────────────
let ctFilter='';
function setTypeFilter(btn,t){document.querySelectorAll('#p-discover .fpill').forEach(p=>p.classList.remove('act'));btn.classList.add('act');ctFilter=t;loadCreators();}
async function loadCreators(){
  const q=new URLSearchParams();const s=document.getElementById('creator-search')?.value||'';
  if(ctFilter)q.set('type',ctFilter);if(s)q.set('search',s);
  const us=await api('/users?'+q);if(!us)return;
  const g=document.getElementById('creators-grid');
  if(!us.length){g.innerHTML='<div style="color:var(--muted);padding:2rem">No creatives found.</div>';return;}
  g.innerHTML=us.map((u,i)=>\`
    <div class="card reveal" style="overflow:hidden">
      <div class="cc-banner \${u.avatar_color||'rust'}"><div class="cc-pat"></div>
        <div class="cc-av cc-av-bg">\${creatorAvHtml(u)}</div>
      </div>
      <div class="cc-body">
        <div class="cc-name">\${u.name}</div>
        <div class="cc-role">\${u.role||''}</div>
        <div class="cc-bio">\${(u.bio||'').slice(0,90)}\${(u.bio||'').length>90?'…':''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px">\${JSON.parse(u.skills||'[]').slice(0,3).map(s=>\`<span class="tag">\${s}</span>\`).join('')}</div>
        <div class="cc-foot">
          <span class="cc-loc">\${u.location||'—'} · \${u.experience_years||0}yr</span>
          \${u.id!==S.user?.id?\`<button class="btn-p" style="padding:4px 13px;font-size:0.72rem" onclick="startDMWith('\${u.id}','\${esc(u.name)}')">Connect</button>\`:\`<span class="tag green">You</span>\`}
        </div>
      </div>
    </div>\`).join('');
  setTimeout(initReveal,50);
}
function creatorAvHtml(u){
  if(u.id===S.user?.id&&S.photoUrl)return\`<img src="\${S.photoUrl}"/>\`;
  return\`<span style="font-family:'Yatra One',serif;font-size:1.05rem;color:var(--rust)">\${u.avatar_init||u.name.charAt(0)}</span>\`;
}
async function startDMWith(uid,name){const r=await api('/conversations',{method:'POST',body:{target_user_id:uid}});if(r?.id){S.currentConv=r.id;goPage('messages');loadConversations();}}

// ── PHOTO UPLOAD ──────────────────────────────────────────────────────────
function triggerPhotoUpload(){document.getElementById('photo-input').click();}
function triggerBannerUpload(){document.getElementById('banner-input').click();}

function handlePhotoUpload(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    S.photoUrl=e.target.result;
    localStorage.setItem('kc_photo',S.photoUrl);
    renderProfilePhoto();updateNavAv();
    toast('Profile photo updated!');
  };
  reader.readAsDataURL(file);
}

function handleBannerUpload(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const banner=document.getElementById('prof-banner');
    if(banner){banner.style.background='none';banner.style.backgroundImage=\`url(\${e.target.result})\`;banner.style.backgroundSize='cover';banner.style.backgroundPosition='center';}
    localStorage.setItem('kc_banner',e.target.result);
    toast('Banner updated!');
  };
  reader.readAsDataURL(file);
}

function renderProfilePhoto(){
  const outer=document.getElementById('prof-av-outer');
  const initials=document.getElementById('prof-av-initials');
  if(!outer)return;
  if(S.photoUrl){
    if(initials)initials.innerHTML=\`<img src="\${S.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>\`;
  }
}

// ── PORTFOLIO ─────────────────────────────────────────────────────────────
function renderPortfolio(){
  const g=document.getElementById('port-grid');if(!g)return;
  const items=S.portfolio;
  g.innerHTML=items.map((p,i)=>\`
    <div class="port-item" onclick="viewPortItem(\${i})">
      <span class="pi-type">\${p.type}</span>
      \${p.url?\`<img src="\${p.url}" onerror="this.style.display='none'"/>\`:\`<span class="pi-icon">\${p.type==='Audio'?'♪':p.type==='Video'?'▶':p.type==='Writing'?'✍':'◉'}</span>\`}
      <div class="pi-label">\${p.title}</div>
    </div>\`).join('')+\`<div class="port-item port-add" onclick="showAddPortfolio()"><div style="font-size:1.5rem;opacity:0.4">+</div><div>Add Work</div></div>\`;
}

function viewPortItem(i){
  const p=S.portfolio[i];
  showModal(\`<div class="modal-hd"><h3>\${p.title}</h3><p>\${p.type} · \${p.description||''}</p></div>
    <div class="modal-body">
      \${p.url&&p.type==='Audio'?\`<audio controls src="\${p.url}" style="width:100%;margin-bottom:0.875rem"></audio>\`:''}
      \${p.url&&p.type==='Video'?\`<video controls src="\${p.url}" style="width:100%;border-radius:6px;margin-bottom:0.875rem"></video>\`:''}
      \${p.url&&(p.type==='Image'||p.type==='Visual')?\`<img src="\${p.url}" style="width:100%;border-radius:6px;margin-bottom:0.875rem"/>\`:''}
      \${p.link?\`<a href="\${p.link}" target="_blank" class="btn-o" style="display:inline-block">View Online →</a>\`:''}
      \${p.description?\`<p style="font-size:0.83rem;color:var(--muted);margin-top:0.875rem">\${p.description}</p>\`:''}
    </div>
    <div class="modal-foot">
      <button class="btn-o" onclick="closeOverlay()">Close</button>
      <button class="btn-sm" style="color:var(--rust)" onclick="removePortItem(\${i});closeOverlay()">Remove</button>
    </div>\`);
}

function removePortItem(i){
  S.portfolio.splice(i,1);localStorage.setItem('kc_portfolio',JSON.stringify(S.portfolio));renderPortfolio();toast('Removed from portfolio');}

function showAddPortfolio(){
  showModal(\`<div class="modal-hd"><h3>Add Portfolio Item</h3><p>Showcase your work</p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Title</label><input class="finp" id="pt-title" placeholder="Track name, film title, artwork..."/></div>
      <div class="fgrp"><label class="flbl">Type</label><select class="finp" id="pt-type"><option>Audio</option><option>Video</option><option>Image</option><option>Visual</option><option>Writing</option></select></div>
      <div class="fgrp"><label class="flbl">Description</label><input class="finp" id="pt-desc" placeholder="Brief description..."/></div>
      <div class="fgrp"><label class="flbl">External Link (SoundCloud, YouTube, etc.)</label><input class="finp" id="pt-link" placeholder="https://..."/></div>
      <div class="fgrp"><label class="flbl">Upload File (image, audio)</label>
        <label class="photo-upload-zone" id="pt-upload-zone">
          <input type="file" id="pt-file" accept="image/*,audio/*,video/*" onchange="previewPortFile(this)"/>
          <div id="pt-preview-area" style="color:var(--muted);font-size:0.82rem">Click to upload a file</div>
        </label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="addPortItem()">Add to Portfolio</button></div>\`);
}

function previewPortFile(input){
  const file=input.files[0];if(!file)return;
  const area=document.getElementById('pt-preview-area');
  if(file.type.startsWith('image/')){
    const reader=new FileReader();
    reader.onload=e=>{area.innerHTML=\`<img class="photo-preview" src="\${e.target.result}"/>\`;area.dataset.url=e.target.result;};
    reader.readAsDataURL(file);
  } else {area.innerHTML=\`<div style="padding:0.5rem;font-size:0.8rem">✓ \${file.name}</div>\`;}
}

function addPortItem(){
  const title=document.getElementById('pt-title')?.value.trim();
  if(!title)return toast('Please add a title');
  const type=document.getElementById('pt-type')?.value||'Audio';
  const desc=document.getElementById('pt-desc')?.value||'';
  const link=document.getElementById('pt-link')?.value||'';
  const area=document.getElementById('pt-preview-area');
  const url=area?.dataset.url||'';
  S.portfolio.push({title,type,description:desc,link,url});
  localStorage.setItem('kc_portfolio',JSON.stringify(S.portfolio));
  closeOverlay();renderPortfolio();toast('Added to portfolio!');
}

// ── FORUM ─────────────────────────────────────────────────────────────────
function setForumFilter(btn,cat){document.querySelectorAll('#p-forum .fpill').forEach(p=>p.classList.remove('act'));btn.classList.add('act');S.forumFilter=cat;renderForum();}
function renderForum(){
  const posts=S.forumFilter==='all'?S.forumPosts:S.forumPosts.filter(p=>p.cat===S.forumFilter);
  document.getElementById('forum-grid').innerHTML=posts.map(p=>\`
    <div class="forum-card reveal" onclick="showForumPost('\${p.id}')">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div class="forum-av \${p.color}">\${getForumAvatar(p)}</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:0.78rem;font-weight:700">\${p.author}</span>
            <div style="display:flex;align-items:center;gap:8px"><span class="fcat \${p.cat}">\${p.cat}</span><span style="font-size:0.68rem;color:var(--muted2)">\${p.time}</span></div>
          </div>
          <div class="forum-title">\${p.title}</div>
          <div class="forum-preview">\${p.body.slice(0,120)}\${p.body.length>120?'…':''}</div>
          <div class="forum-meta"><span>♥ \${p.likes}</span><span>💬 \${p.comments}</span></div>
        </div>
      </div>
    </div>\`).join('');
  setTimeout(initReveal,50);
}
function getForumAvatar(p){
  if(p.author===S.user?.name&&S.photoUrl)return\`<img src="\${S.photoUrl}"/>\`;
  return p.init;
}
function showForumPost(id){
  const p=S.forumPosts.find(x=>x.id===id);if(!p)return;
  showModal(\`<div class="modal-hd"><h3>\${p.title}</h3><p>By \${p.author} · \${p.time}</p></div>
    <div class="modal-body">
      <div style="font-size:0.86rem;color:var(--ink);line-height:1.65;margin-bottom:1rem">\${p.body}</div>
      \${p.link?\`<a href="\${p.link}" target="_blank" class="btn-o" style="display:inline-block;margin-bottom:1rem;font-size:0.8rem">View Work →</a>\`:''}
      <div style="border-top:1px solid var(--border);padding-top:0.875rem">
        <div class="flbl" style="margin-bottom:6px">Leave a comment</div>
        <textarea class="finp" id="forum-comment" style="height:70px" placeholder="Share your thoughts..."></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-o" onclick="closeOverlay()">Close</button>
      <button class="btn-p" onclick="likePost('\${id}')">♥ Like (\${p.likes})</button>
      <button class="btn-p" onclick="postComment('\${id}')">Comment</button>
    </div>\`);
}
function likePost(id){const p=S.forumPosts.find(x=>x.id===id);if(p)p.likes++;closeOverlay();renderForum();toast('Liked!');}
function postComment(id){const t=document.getElementById('forum-comment')?.value;if(!t?.trim())return;const p=S.forumPosts.find(x=>x.id===id);if(p)p.comments++;closeOverlay();renderForum();toast('Comment posted!');}
function showNewPost(){
  showModal(\`<div class="modal-hd"><h3>New Post</h3><p>Share with the Kalachautari community</p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Title</label><input class="finp" id="np-title" placeholder="What are you sharing?"/></div>
      <div class="fgrp"><label class="flbl">Category</label><select class="finp" id="np-cat"><option value="general">General</option><option value="music">Music</option><option value="film">Film</option><option value="art">Art</option><option value="inspo">Inspiration</option></select></div>
      <div class="fgrp"><label class="flbl">Content</label><textarea class="finp" id="np-body" style="height:100px" placeholder="Share your thoughts, work, or inspiration..."></textarea></div>
      <div class="fgrp"><label class="flbl">Link (optional)</label><input class="finp" id="np-link" placeholder="SoundCloud, YouTube..."/></div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="createPost()">Post</button></div>\`);
}
function createPost(){
  const title=document.getElementById('np-title')?.value.trim();
  const body=document.getElementById('np-body')?.value.trim();
  if(!title||!body)return toast('Title and content are required');
  S.forumPosts.unshift({id:'f'+Date.now(),author:S.user?.name||'You',init:S.user?.avatar_init||'?',color:S.user?.avatar_color||'rust',cat:document.getElementById('np-cat')?.value||'general',title,body,link:document.getElementById('np-link')?.value||'',likes:0,comments:0,time:'just now'});
  closeOverlay();renderForum();toast('Posted to the community!');
}

// ── EVENTS ────────────────────────────────────────────────────────────────
async function loadEvents(){
  const evs=await api('/events');if(!evs)return;
  const list=document.getElementById('events-list');
  if(!evs.length){list.innerHTML='<div style="color:var(--muted)">No events yet.</div>';return;}
  list.innerHTML=evs.map(e=>{
    const d=new Date(e.event_date);
    const day=d.getDate().toString().padStart(2,'0');
    const mon=d.toLocaleString('default',{month:'short'}).toUpperCase();
    return\`<div class="ev-card reveal">
      <div class="ev-date \${e.is_free?'free':'paid'}"><div class="ev-day">\${day}</div><div class="ev-mon">\${mon}</div></div>
      <div class="ev-body">
        <div class="ev-title">\${e.title}</div>
        <div class="ev-meta">\${e.location}\${e.event_time?' · '+e.event_time:''}\${e.is_online?' · Online':''}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
          \${JSON.parse(e.tags||'[]').map(t=>\`<span class="tag">\${t}</span>\`).join('')}
          \${e.is_free?'<span class="tag green">Free</span>':'<span class="tag gold">Ticketed</span>'}
        </div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:4px">\${e.rsvp_count||0} attending · By \${e.creator_name||'Kalachautari'}</div>
      </div>
      <div class="ev-act">
        <button class="btn-p" style="font-size:0.72rem;padding:5px 12px" onclick="showRSVP('\${e.id}','\${esc(e.title)}','\${e.location}','\${e.event_date}',\${JSON.stringify(e.ticket_tiers).replace(/"/g,'&quot;')})">RSVP</button>
        <button class="btn-sm">Share</button>
      </div>
    </div>\`;
  }).join('');
  setTimeout(initReveal,50);
}
function showRSVP(eid,title,loc,date,ts){
  const tiers=JSON.parse(ts.replace(/&quot;/g,'"'));
  showModal(\`<div class="modal-hd"><h3>\${title}</h3><p>\${loc} · \${date}</p></div>
    <div class="modal-body">
      <div class="flbl" style="margin-bottom:8px">Select Ticket</div>
      \${tiers.map((t,i)=>\`<div class="tkt-tier \${i===0?'sel':''}" onclick="this.closest('.modal-body').querySelectorAll('.tkt-tier').forEach(x=>x.classList.remove('sel'));this.classList.add('sel')" data-tier="\${t.name}">
        <div><div class="tkt-tier-n">\${t.name}</div><div class="tkt-tier-d">\${t.desc||''}</div></div>
        <div class="tkt-price">\${t.price===0?'Free':'Rs '+t.price}</div>
      </div>\`).join('')}
      <div class="fgrp" style="margin-top:0.875rem"><label class="flbl">Qty</label><input class="finp" type="number" id="rsvp-qty" value="1" min="1" max="10" style="width:80px"/></div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="confirmRSVP('\${eid}')">Confirm RSVP</button></div>\`);
}
async function confirmRSVP(eid){
  const sel=document.querySelector('#modal-content .tkt-tier.sel');
  const res=await api(\`/events/\${eid}/rsvp\`,{method:'POST',body:{tier:sel?.dataset.tier||'General',qty:parseInt(document.getElementById('rsvp-qty')?.value)||1}});
  closeOverlay();
  if(res?.error==="Already RSVP'd")return toast("You've already RSVP'd!");
  toast('RSVP confirmed!');loadEvents();
}
function showCreateEvent(){
  showModal(\`<div class="modal-hd"><h3>Create Event</h3><p>Visible to all members immediately</p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Title *</label><input class="finp" id="ev-title" placeholder="Kala Saanjh — Open Mic"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="fgrp"><label class="flbl">Date *</label><input class="finp" type="date" id="ev-date"/></div>
        <div class="fgrp"><label class="flbl">Time</label><input class="finp" type="time" id="ev-time"/></div>
      </div>
      <div class="fgrp"><label class="flbl">Location</label><input class="finp" id="ev-loc" placeholder="Patan Dhoka / Online"/></div>
      <div class="fgrp"><label class="flbl">Description</label><textarea class="finp" id="ev-desc" style="height:70px"></textarea></div>
      <div style="display:flex;gap:14px">
        <label style="display:flex;align-items:center;gap:5px;font-size:0.82rem"><input type="checkbox" id="ev-free" checked/> Free</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:0.82rem"><input type="checkbox" id="ev-online"/> Online</label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="createEvent()">Create</button></div>\`);
}
async function createEvent(){
  const title=document.getElementById('ev-title')?.value.trim();
  const date=document.getElementById('ev-date')?.value;
  if(!title||!date)return toast('Title and date required');
  const res=await api('/events',{method:'POST',body:{title,description:document.getElementById('ev-desc')?.value||'',location:document.getElementById('ev-loc')?.value||'',event_date:date,event_time:document.getElementById('ev-time')?.value||'',is_free:document.getElementById('ev-free')?.checked?1:0,is_online:document.getElementById('ev-online')?.checked?1:0,ticket_tiers:[{name:'General',price:0,desc:'Open entry'}],tags:[]}});
  closeOverlay();if(res?.error)return toast('Error: '+res.error);toast('Event created!');loadEvents();
}

// ── MESSAGES ──────────────────────────────────────────────────────────────
async function loadConversations(){
  const cs=await api('/conversations');if(!cs)return;
  const list=document.getElementById('conv-items');
  if(!cs.length){list.innerHTML='<div style="padding:1rem;font-size:0.78rem;color:var(--muted)">No conversations yet.</div>';return;}
  list.innerHTML=cs.map(c=>{
    const other=c.type==='direct'?c.members?.find(m=>m.id!==S.user?.id):null;
    const name=c.type==='group'?(c.name||'Group'):(other?.name||'Unknown');
    const init=c.type==='group'?'#':(other?.avatar_init||'?');
    return\`<div class="ci \${c.id===S.currentConv?'act':''}" onclick="openConv('\${c.id}','\${esc(name)}','\${init}','\${c.type}')">
      <div style="display:flex;justify-content:space-between"><span class="ci-name">\${name}</span><span class="ci-t">\${fmtTime(c.last_time)}</span></div>
      <div class="ci-prev">\${c.last_msg||'(no messages yet)'}</div>
    </div>\`;
  }).join('');
  if(S.currentConv){const conv=cs.find(c=>c.id===S.currentConv);if(conv){const other=conv.members?.find(m=>m.id!==S.user?.id);renderChatArea(S.currentConv,conv.type==='group'?(conv.name||'Group'):(other?.name||'Unknown'),conv.type==='group'?'#':(other?.avatar_init||'?'),conv.type,conv.members);}}
}
async function openConv(cid,name,init,type){
  S.currentConv=cid;
  document.querySelectorAll('.ci').forEach(c=>c.classList.remove('act'));
  event?.currentTarget?.classList.add('act');
  const cd=await api('/conversations');
  const conv=cd?.find(c=>c.id===cid);
  renderChatArea(cid,name,init,type,conv?.members||[]);
}
async function renderChatArea(cid,name,init,type,members){
  const ms=await api(\`/conversations/\${cid}/messages\`);if(!ms)return;
  const mb=type==='group'&&members.length?\`<div style="padding:5px 1rem;border-top:1px solid var(--border);display:flex;gap:4px;align-items:center;background:var(--card);flex-shrink:0">\${members.map(m=>\`<div style="width:22px;height:22px;border-radius:50%;background:var(--cream2);display:flex;align-items:center;justify-content:center;font-size:0.55rem;font-weight:700;color:var(--rust)">\${m.avatar_init||'?'}</div>\`).join('')}<span style="font-size:0.68rem;color:var(--muted);margin-left:3px">\${members.length} members</span></div>\`:'';
  document.getElementById('chat-area').innerHTML=\`
    <div class="chat-hd">
      <div class="chat-av \${type==='group'?'grp':''}">\${init}</div>
      <div><div style="font-weight:700;font-size:0.88rem">\${name}</div><div style="font-size:0.7rem;color:var(--muted)">\${type==='group'?'Group Chat':'Direct Message'}</div></div>
    </div>
    <div class="chat-msgs" id="msgs-box">\${ms.map(m=>msgBubble(m)).join('')}</div>
    \${mb}
    <div class="chat-inp"><input id="chat-input" placeholder="Type a message…" onkeydown="if(event.key==='Enter')sendMsg('\${cid}')"/><button class="chat-send" onclick="sendMsg('\${cid}')">Send</button></div>\`;
  const box=document.getElementById('msgs-box');if(box)box.scrollTop=box.scrollHeight;
}
function msgBubble(m){
  const isOut=m.sender_id===S.user?.id,isSys=m.type==='system';
  if(isSys)return\`<div class="msg sys"><div class="mbub">\${m.content}</div></div>\`;
  return\`<div class="msg \${isOut?'out':'in'}">\${!isOut&&m.sender_name?\`<div style="font-size:0.62rem;color:var(--muted);margin-bottom:2px">\${m.sender_name}</div>\`:''}<div class="mbub">\${m.content}</div><div class="mt">\${fmtTime(m.created_at)}</div></div>\`;
}
function appendMessage(m){const b=document.getElementById('msgs-box');if(!b)return;b.insertAdjacentHTML('beforeend',msgBubble(m));b.scrollTop=b.scrollHeight;}
function updateConvPreview(cid,c){const ci=document.querySelector(\`.ci[onclick*="\${cid}"] .ci-prev\`);if(ci)ci.textContent=c.slice(0,50);}
function sendMsg(cid){
  const inp=document.getElementById('chat-input');if(!inp||!inp.value.trim())return;
  const content=inp.value.trim();inp.value='';
  if(S.ws&&S.ws.readyState===WebSocket.OPEN)S.ws.send(JSON.stringify({event:'message',data:{conv_id:cid,content}}));
  appendMessage({sender_id:S.user?.id,sender_name:S.user?.name,type:'text',content,created_at:new Date().toISOString()});
}
function showNewConvModal(){
  showModal(\`<div class="modal-hd"><h3>New Conversation</h3><p>Search for a creative to message</p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Search by Name</label><input class="finp" id="nc-search" placeholder="Type a name…" oninput="searchNewConv(this.value)"/></div>
      <div id="nc-results" style="display:flex;flex-direction:column;gap:5px;margin-top:8px"></div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button></div>\`);
}
async function searchNewConv(q){
  if(!q.length)return;
  const res=await api('/search?q='+encodeURIComponent(q));
  const el=document.getElementById('nc-results');if(!el||!res)return;
  el.innerHTML=res.users.map(u=>\`<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--cream2);border-radius:5px;cursor:pointer" onclick="startDMWith('\${u.id}','\${esc(u.name)}');closeOverlay()">
    <div style="width:30px;height:30px;border-radius:50%;background:var(--cream2);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:var(--rust)">\${u.avatar_init||u.name.charAt(0)}</div>
    <div><div style="font-size:0.85rem;font-weight:700">\${u.name}</div><div style="font-size:0.7rem;color:var(--muted)">\${u.role||''}</div></div>
  </div>\`).join('')||'<div style="font-size:0.78rem;color:var(--muted)">No results</div>';
}

// ── MATCH ─────────────────────────────────────────────────────────────────
async function loadMatchCandidates(){
  const cs=await api('/matches/suggestions');if(!cs)return;
  S.swipeCandidates=cs;S.swipeIdx=0;renderSwipeCards();
}
function renderSwipeCards(){
  const stack=document.getElementById('swipe-stack');
  const rem=S.swipeCandidates.slice(S.swipeIdx,S.swipeIdx+2);
  if(!rem.length){stack.innerHTML=\`<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:10px;color:var(--muted)"><div style="font-size:3.5rem;opacity:0.12;font-family:'Yatra One',serif">✓</div><div style="font-size:0.87rem">You've seen everyone for now!</div><button class="btn-o" style="margin-top:8px" onclick="loadMatchCandidates()">Refresh</button></div>\`;return;}
  stack.innerHTML=rem.map((c,ri)=>\`
    <div class="swipe-card \${ri===0?'front':'back'}">
      <div class="sw-banner \${c.avatar_color||'rust'}"><div class="cc-pat"></div>
        <div class="sw-av">\${c.id===S.user?.id&&S.photoUrl?\`<img src="\${S.photoUrl}"/>\`:\`<span style="font-family:'Yatra One',serif;font-size:1.2rem;color:var(--rust)">\${c.avatar_init||c.name.charAt(0)}</span>\`}</div>
      </div>
      <div class="sw-info">
        <div class="sw-name">\${c.name}</div>
        <div class="sw-role">\${c.role||''}</div>
        <div class="match-score"><strong>\${c.match_score}% match</strong> — based on genre & discipline</div>
        <div style="font-size:0.8rem;color:var(--muted);line-height:1.45;margin-bottom:8px">\${(c.bio||'').slice(0,100)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px">\${JSON.parse(c.skills||'[]').slice(0,3).map(s=>\`<span class="tag">\${s}</span>\`).join('')}</div>
        <div style="font-size:0.7rem;color:var(--muted2)">\${c.location||'—'} · \${c.experience_years||0} yrs\${c.open_to_remote?' · Remote OK':''}</div>
      </div>
    </div>\`).join('');
}
async function swipe(dir){
  if(S.swipeIdx>=S.swipeCandidates.length)return;
  const top=document.querySelector('#swipe-stack .swipe-card.front');if(!top)return;
  const candidate=S.swipeCandidates[S.swipeIdx];
  if(dir==='left')top.classList.add('gone-l');
  else{
    top.classList.add('gone-r');
    const res=await api('/matches',{method:'POST',body:{target_id:candidate.id,type:dir==='super'?'super':'connect'}});
    if(res?.matched){
      S.recentConnects.unshift(candidate);renderRecentConnects();
      document.getElementById('match-pop-wrap').style.display='block';
      document.getElementById('match-msg-btn').onclick=async()=>{const c=await api('/conversations',{method:'POST',body:{target_user_id:candidate.id}});if(c?.id){S.currentConv=c.id;goPage('messages');loadConversations();}document.getElementById('match-pop-wrap').style.display='none';};
    }
  }
  S.swipeIdx++;setTimeout(()=>renderSwipeCards(),350);
}
function renderRecentConnects(){
  const el=document.getElementById('recent-connects');if(!el)return;
  if(!S.recentConnects.length){el.innerHTML='<div style="font-size:0.75rem;color:var(--muted)">No connects yet</div>';return;}
  el.innerHTML=S.recentConnects.slice(0,4).map(c=>\`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <div style="width:30px;height:30px;border-radius:50%;background:\${colorMap(c.avatar_color)};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#fff">\${c.avatar_init||c.name.charAt(0)}</div>
    <div style="flex:1"><div style="font-size:0.8rem;font-weight:700">\${c.name}</div><div style="font-size:0.68rem;color:var(--muted)">\${(c.role||'').split('·')[0].trim()}</div></div>
    <button class="btn-sm" style="font-size:0.65rem" onclick="startDMWith('\${c.id}','\${esc(c.name)}')">Chat</button>
  </div>\`).join('');
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────
async function loadNotifCount(){
  const ns=await api('/notifications');if(!ns)return;
  const u=ns.filter(n=>!n.read).length;
  const b=document.getElementById('notif-badge');b.textContent=u;b.style.display=u>0?'inline':'none';
}
async function loadNotifications(){
  const ns=await api('/notifications');if(!ns)return;
  const list=document.getElementById('notif-list');
  if(!ns.length){list.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--muted)">No notifications yet</div>';return;}
  const icons={interest:'✉',accepted:'✓',declined:'✕',match:'★',rsvp:'✦',notification:'◉'};
  list.innerHTML=ns.map(n=>\`<div class="notif-item \${n.read?'':'unr'}">
    <div class="n-dot \${n.read?'r':''}"></div>
    <div class="n-av">\${icons[n.type]||'◉'}</div>
    <div style="flex:1"><div style="font-size:0.83rem;font-weight:700">\${n.title}</div><div style="font-size:0.75rem;color:var(--muted)">\${n.body||''}</div><div style="font-size:0.65rem;color:var(--muted2);margin-top:2px">\${fmtTime(n.created_at)}</div></div>
  </div>\`).join('');
}
async function markAllRead(){await api('/notifications/read',{method:'PATCH'});loadNotifications();loadNotifCount();toast('All read');}

// ── PROFILE ───────────────────────────────────────────────────────────────
async function loadProfile(){
  const user=await api('/users/'+S.user.id);if(!user)return;
  document.getElementById('prof-name').textContent=user.name;
  document.getElementById('prof-role').textContent=user.role||'';
  document.getElementById('prof-bio').textContent=user.bio||'Add a bio in Edit Profile';
  document.getElementById('prof-stat-proj').textContent=user.projects?.length||0;
  document.getElementById('prof-stat-exp').textContent=(user.experience_years||0)+'yr';
  document.getElementById('prof-stat-loc').textContent=(user.location||'?').split(',')[0].slice(0,8);
  document.getElementById('prof-location').textContent=user.location||'Not set';
  const initEl=document.getElementById('prof-av-initials');
  if(initEl){
    if(S.photoUrl)initEl.innerHTML=\`<img src="\${S.photoUrl}" style="width:100%;height:100%;object-fit:cover"/>\`;
    else{initEl.className='prof-av-initials';initEl.textContent=user.avatar_init||user.name.charAt(0);}
  }
  // restore banner
  const savedBanner=localStorage.getItem('kc_banner');
  const banner=document.getElementById('prof-banner');
  if(savedBanner&&banner){banner.style.background='none';banner.style.backgroundImage=\`url(\${savedBanner})\`;banner.style.backgroundSize='cover';banner.style.backgroundPosition='center';}
  else if(banner){banner.className='prof-banner '+(user.avatar_color||'rust');}
  document.getElementById('prof-skills').innerHTML=JSON.parse(user.skills||'[]').map(s=>\`<div class="sk-bar"><div class="sk-n"><span>\${s}</span></div><div class="sk-track"><div class="sk-fill" style="width:\${70+Math.floor(Math.random()*25)}%"></div></div></div>\`).join('');
  document.getElementById('prof-genres').innerHTML=JSON.parse(user.genres||'[]').map(g=>\`<span class="tag rust">\${g}</span>\`).join('');
  document.getElementById('my-projects-list').innerHTML=(user.projects||[]).map(p=>\`<div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--card);border:1.5px solid var(--border);border-radius:7px">
    <div style="flex:1"><div style="font-size:0.83rem;font-weight:700">\${p.title}</div><div style="font-size:0.7rem;color:var(--muted)">\${p.type}</div></div>
    <span class="tag \${p.status==='open'?'green':''}">\${p.status}</span>
    <button class="btn-sm" onclick="viewInterests('\${p.id}','\${esc(p.title)}')">Interests</button>
  </div>\`).join('')||'<div style="font-size:0.8rem;color:var(--muted)">No projects yet. <button class="btn-sm" onclick="goPage(\\'post-project\\')">Post one!</button></div>';
  document.getElementById('collab-history').innerHTML=\`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--card);border:1.5px solid var(--border);border-radius:7px"><div class="ow-av" style="width:28px;height:28px;font-size:0.62rem">RT</div><div style="flex:1"><div style="font-size:0.82rem;font-weight:700">Roshan Tamang · Short Film "Bato"</div><div style="font-size:0.7rem;color:var(--muted)">Soundtrack Composer · 2024</div></div><span class="tag green">Done</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--card);border:1.5px solid var(--border);border-radius:7px"><div class="ow-av" style="width:28px;height:28px;font-size:0.62rem;background:var(--himalaya-light);color:var(--himalaya2)">SK</div><div style="flex:1"><div style="font-size:0.82rem;font-weight:700">Sanjay KC · Himalaya EP</div><div style="font-size:0.7rem;color:var(--muted)">Lead Vocals · Ongoing</div></div><span class="tag gold">Active</span></div>\`;
  renderPortfolio();
}
function showEditProfile(){
  const u=S.user;
  showModal(\`<div class="modal-hd"><h3>Edit Profile</h3><p>Changes saved immediately</p></div>
    <div class="modal-body">
      <div class="fgrp"><label class="flbl">Name</label><input class="finp" id="ep-name" value="\${u.name||''}"/></div>
      <div class="fgrp"><label class="flbl">Role / Title</label><input class="finp" id="ep-role" value="\${u.role||''}" placeholder="Singer, Filmmaker, Poet…"/></div>
      <div class="fgrp"><label class="flbl">Bio</label><textarea class="finp" id="ep-bio" style="height:80px">\${u.bio||''}</textarea></div>
      <div class="fgrp"><label class="flbl">Location</label><input class="finp" id="ep-loc" value="\${u.location||''}"/></div>
      <div class="fgrp"><label class="flbl">Years Experience</label><input class="finp" type="number" id="ep-exp" value="\${u.experience_years||0}" min="0" max="50" style="width:80px"/></div>
      <div class="fgrp"><label class="flbl">Skills (comma separated)</label><input class="finp" id="ep-skills" value="\${JSON.parse(u.skills||'[]').join(', ')}"/></div>
      <div class="fgrp"><label class="flbl">Genres (comma separated)</label><input class="finp" id="ep-genres" value="\${JSON.parse(u.genres||'[]').join(', ')}"/></div>
    </div>
    <div class="modal-foot"><button class="btn-o" onclick="closeOverlay()">Cancel</button><button class="btn-p" onclick="saveProfile()">Save Changes</button></div>\`);
}
async function saveProfile(){
  const body={name:document.getElementById('ep-name')?.value.trim(),role:document.getElementById('ep-role')?.value.trim(),bio:document.getElementById('ep-bio')?.value.trim(),location:document.getElementById('ep-loc')?.value.trim(),experience_years:parseInt(document.getElementById('ep-exp')?.value)||0,skills:document.getElementById('ep-skills')?.value.split(',').map(s=>s.trim()).filter(Boolean),genres:document.getElementById('ep-genres')?.value.split(',').map(s=>s.trim()).filter(Boolean)};
  const res=await api('/users/me',{method:'PATCH',body});closeOverlay();if(res?.error)return toast('Error: '+res.error);
  S.user={...S.user,...res};localStorage.setItem('kc_user',JSON.stringify(S.user));updateNavAv();toast('Profile updated!');loadProfile();
}

// ── POST PROJECT ──────────────────────────────────────────────────────────
function showPfStep(n){
  S.pfStep=n;
  document.querySelectorAll('.form-step').forEach(s=>s.classList.remove('act'));
  document.getElementById('pfs'+n).classList.add('act');
  document.querySelectorAll('#pf-si .step-dot').forEach((d,i)=>{d.classList.remove('done','cur');if(i<n-1)d.classList.add('done');if(i===n-1)d.classList.add('cur');});
  if(n===4)buildPreview();
}
function pfNext(n){
  if(n>S.pfStep){
    if(S.pfStep===1){if(!document.getElementById('pf-title').value.trim())return toast('Please add a title');if(!document.getElementById('pf-type').value)return toast('Please select a type');if(!document.getElementById('pf-desc').value.trim())return toast('Please add a description');}
  }
  showPfStep(n);
}
function buildPreview(){
  const title=document.getElementById('pf-title').value||'(untitled)';
  const type=document.getElementById('pf-type').value||'—';
  const desc=document.getElementById('pf-desc').value||'';
  const roles=[...document.querySelectorAll('#pf-roles .rp-btn.sel')].map(b=>b.textContent.trim());
  document.getElementById('pf-preview').innerHTML=\`<div style="font-weight:700;font-size:1rem;margin-bottom:3px">\${title}</div><div style="font-size:0.7rem;color:var(--rust);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">\${type}</div><div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px">\${desc}</div><div>\${roles.map(r=>\`<span class="need">\${r}</span>\`).join('')}</div>\`;
}
async function publishProject(){
  const btn=document.getElementById('publish-btn');btn.disabled=true;btn.textContent='Publishing...';
  const res=await api('/projects',{method:'POST',body:{title:document.getElementById('pf-title').value.trim(),title_np:document.getElementById('pf-title-np').value,type:document.getElementById('pf-type').value,description:document.getElementById('pf-desc').value.trim(),roles_needed:[...document.querySelectorAll('#pf-roles .rp-btn.sel')].map(b=>b.textContent.trim()),timeline:document.getElementById('pf-timeline').value,location:document.getElementById('pf-location').value,remote_ok:document.getElementById('pf-remote').checked,experience_req:document.getElementById('pf-exp').value,media_links:[document.getElementById('pf-link1').value,document.getElementById('pf-link2').value].filter(Boolean),cover_url:document.getElementById('pf-cover').value}});
  btn.disabled=false;btn.textContent='Publish Project';
  if(res?.error)return toast('Error: '+res.error);
  toast('Project is now live!');goPage('projects');
}

// ── INIT ──────────────────────────────────────────────────────────────────
if(S.token&&S.user){loginSuccess(S.token,S.user);}
</script>
</body>
</html>
`;
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(INDEX_HTML);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  let userId = null;
  try { userId = jwt.verify(token, JWT_SECRET).id; wsClients.set(userId, ws); }
  catch { ws.close(); return; }

  ws.on('message', raw => {
    try {
      const { event, data } = JSON.parse(raw);
      if (event === 'message') {
        const { conv_id, content } = data;
        if (!db.get2('SELECT conv_id FROM conv_members WHERE conv_id=? AND user_id=?', [conv_id,userId])) return;
        const id = uuid();
        db.run2(`INSERT INTO messages (id,conv_id,sender_id,type,content) VALUES (?,?,?,?,?)`, [id,conv_id,userId,'text',content]);
        saveDb();
        const sender = db.get2('SELECT name,avatar_init FROM users WHERE id=?', [userId]);
        const msg = { id,conv_id,sender_id:userId,sender_name:sender.name,sender_init:sender.avatar_init,type:'text',content,created_at:new Date().toISOString() };
        db.all2('SELECT user_id FROM conv_members WHERE conv_id=?', [conv_id]).forEach(m => {
          const mws = wsClients.get(m.user_id);
          if (mws && mws.readyState===WebSocket.OPEN) mws.send(JSON.stringify({ event:'message', data:msg }));
        });
      }
      if (event==='ping') ws.send(JSON.stringify({ event:'pong' }));
    } catch {}
  });

  ws.on('close', () => wsClients.delete(userId));
  ws.send(JSON.stringify({ event:'connected', data:{ userId } }));
});

// ─── Start ────────────────────────────────────────────────────────────────────
initSqlJs().then(SQL => {
  initDb(SQL);
  server.listen(PORT, () => {
    console.log(`\n🌿 Kalachautari running on http://localhost:${PORT}`);
    console.log(`   Demo login: aasha@demo.com / demo1234`);
    console.log(`   Admin: http://localhost:${PORT}/admin?key=${ADMIN_SECRET}\n`);
  });
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
