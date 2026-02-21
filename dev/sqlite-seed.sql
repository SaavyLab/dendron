-- ============================================================
-- dendron dev database — SQLite
-- Covers: INTEGER, REAL, NUMERIC, TEXT, BLOB, NULL,
--         JSON (as TEXT), CHECK constraints, FK,
--         DEFAULT, UNIQUE, timestamps as TEXT/INTEGER
-- ============================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;


-- ─── Tables ───────────────────────────────────────────────────

CREATE TABLE categories (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    name        TEXT     NOT NULL UNIQUE,
    slug        TEXT     NOT NULL UNIQUE,
    parent_id   INTEGER  REFERENCES categories(id),
    sort_order  INTEGER  NOT NULL DEFAULT 0,
    is_visible  INTEGER  NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),  -- boolean as INTEGER
    metadata    TEXT,                                                        -- JSON as TEXT
    created_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE authors (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    username    TEXT     NOT NULL UNIQUE COLLATE NOCASE,
    email       TEXT     NOT NULL UNIQUE,
    full_name   TEXT,
    bio         TEXT,
    avatar_url  TEXT,
    twitter     TEXT,
    website     TEXT,
    is_staff    INTEGER  NOT NULL DEFAULT 0 CHECK (is_staff IN (0, 1)),
    post_count  INTEGER  NOT NULL DEFAULT 0,
    follower_count INTEGER NOT NULL DEFAULT 0,
    rating      REAL     NOT NULL DEFAULT 0.0,
    settings    TEXT     NOT NULL DEFAULT '{}',     -- JSON as TEXT
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    last_seen   TEXT,
    birth_year  INTEGER  CHECK (birth_year > 1900 AND birth_year < 2100)
);

CREATE TABLE posts (
    id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    author_id       INTEGER  NOT NULL REFERENCES authors(id),
    category_id     INTEGER  REFERENCES categories(id),
    title           TEXT     NOT NULL,
    slug            TEXT     NOT NULL UNIQUE,
    excerpt         TEXT,
    body            TEXT,
    status          TEXT     NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'scheduled')),
    is_featured     INTEGER  NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
    is_pinned       INTEGER  NOT NULL DEFAULT 0,
    view_count      INTEGER  NOT NULL DEFAULT 0,
    like_count      INTEGER  NOT NULL DEFAULT 0,
    comment_count   INTEGER  NOT NULL DEFAULT 0,
    reading_time_min INTEGER,
    word_count      INTEGER,
    cover_image     TEXT,
    tags            TEXT     NOT NULL DEFAULT '[]',  -- JSON array as TEXT
    meta            TEXT,                             -- JSON as TEXT
    published_at    TEXT,                             -- ISO-8601 TEXT
    scheduled_for   TEXT,
    created_at      TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE comments (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER  NOT NULL REFERENCES posts(id),
    author_id   INTEGER  REFERENCES authors(id),
    parent_id   INTEGER  REFERENCES comments(id),    -- for threading
    guest_name  TEXT,                                 -- for non-registered commenters
    guest_email TEXT,
    body        TEXT     NOT NULL,
    is_approved INTEGER  NOT NULL DEFAULT 0,
    is_spam     INTEGER  NOT NULL DEFAULT 0,
    ip_address  TEXT,
    user_agent  TEXT,
    like_count  INTEGER  NOT NULL DEFAULT 0,
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tags (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    name        TEXT     NOT NULL UNIQUE,
    slug        TEXT     NOT NULL UNIQUE,
    description TEXT,
    color       TEXT     CHECK (length(color) = 7 OR color IS NULL),  -- hex
    post_count  INTEGER  NOT NULL DEFAULT 0,
    created_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE post_tags (
    post_id     INTEGER  NOT NULL REFERENCES posts(id),
    tag_id      INTEGER  NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE media (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    uploader_id INTEGER  REFERENCES authors(id),
    filename    TEXT     NOT NULL,
    original_name TEXT   NOT NULL,
    mime_type   TEXT     NOT NULL,
    size_bytes  INTEGER  NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration_s  REAL,                   -- for video/audio
    checksum    TEXT,                   -- MD5/SHA256
    thumbnail   BLOB,                  -- BLOB: small thumbnail binary
    alt_text    TEXT,
    caption     TEXT,
    exif        TEXT,                   -- JSON as TEXT
    storage_path TEXT    NOT NULL,
    cdn_url     TEXT,
    is_public   INTEGER  NOT NULL DEFAULT 1,
    created_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE site_settings (
    key         TEXT     PRIMARY KEY,
    value       TEXT,
    value_type  TEXT     NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'integer', 'real', 'boolean', 'json', 'null')),
    description TEXT,
    is_public   INTEGER  NOT NULL DEFAULT 0,
    updated_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE page_views (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER  REFERENCES posts(id),
    session_id  TEXT,
    path        TEXT     NOT NULL,
    referrer    TEXT,
    country     TEXT,
    device      TEXT     CHECK (device IN ('desktop', 'mobile', 'tablet', NULL)),
    browser     TEXT,
    duration_s  REAL,
    viewed_at   INTEGER  NOT NULL DEFAULT (unixepoch())  -- Unix timestamp as INTEGER
);


-- ─── Seed Data ────────────────────────────────────────────────

INSERT INTO categories (name, slug, parent_id, sort_order, is_visible, metadata) VALUES
('Technology',    'technology',    NULL, 1, 1, '{"icon": "💻", "featured": true}'),
('Programming',   'programming',   1,    1, 1, '{"icon": "⌨️", "featured": true}'),
('Databases',     'databases',     2,    2, 1, '{"icon": "🗄️", "featured": false}'),
('DevOps',        'devops',        1,    3, 1, '{"icon": "🚀", "featured": false}'),
('Design',        'design',        NULL, 2, 1, '{"icon": "🎨", "featured": true}'),
('UX',            'ux',            5,    1, 1, '{"icon": "🖱️", "featured": false}'),
('Personal',      'personal',      NULL, 3, 0, NULL),
('Meta',          'meta',          NULL, 4, 0, '{"icon": "📝"}');

INSERT INTO tags (name, slug, description, color) VALUES
('rust',        'rust',       'Rust programming language',                '#F74C00'),
('typescript',  'typescript', 'TypeScript and JavaScript ecosystem',      '#3178C6'),
('postgresql',  'postgresql', 'PostgreSQL database tips and internals',   '#336791'),
('sqlite',      'sqlite',     'SQLite embedded database',                 '#0F80CC'),
('performance', 'performance','Query and application performance',        '#F59E0B'),
('beginner',    'beginner',   'Suitable for beginners',                   '#10B981'),
('deep-dive',   'deep-dive',  'In-depth technical exploration',           '#8B5CF6'),
('open-source', 'open-source','Open source projects and contributions',   '#EC4899');

INSERT INTO authors (username, email, full_name, bio, avatar_url, twitter, website, is_staff, post_count, follower_count, rating, settings, last_seen, birth_year) VALUES
('alice_writes', 'alice@blog.example.com', 'Alice Johnson',
 'Senior engineer and occasional writer. I cover databases, performance, and developer tooling. Previously at a startup you haven''t heard of. Now at a startup you have.',
 'https://cdn.example.com/avatars/alice.jpg', '@alice_writes', 'https://alice.dev',
 1, 12, 2847, 4.8,
 '{"editor": "vim", "theme": "dark", "email_notifications": true, "rss_enabled": true}',
 datetime('now', '-2 hours'), 1992),

('bob_codes', 'bob@blog.example.com', 'Bob Smith',
 'Frontend dev. Writes about React, TypeScript, and CSS tricks that actually work.',
 'https://cdn.example.com/avatars/bob.jpg', '@bob_codes', NULL,
 0, 5, 412, 4.2,
 '{"editor": "vscode", "theme": "light"}',
 datetime('now', '-1 day'), 1996),

('carol_devs', 'carol@blog.example.com', 'Carol Williams',
 'Full-stack engineer. Enterprise software survivor. I write about architecture, tradeoffs, and the stuff they don''t teach you in bootcamp.',
 NULL, NULL, 'https://carol.engineering',
 1, 8, 1203, 4.6,
 '{"editor": "emacs", "theme": "dark", "draft_autosave": true}',
 datetime('now', '-3 days'), 1983),

('maya_ml', 'maya@blog.example.com', 'Maya Singh',
 'ML researcher. Writes about LLMs, vector databases, and the gap between academic papers and production systems. Views my own.',
 'https://cdn.example.com/avatars/maya.jpg', '@maya_ml', 'https://maya.research',
 0, 3, 891, 4.9,
 '{"editor": "jupyter", "theme": "dark", "latex_support": true}',
 datetime('now', '-5 hours'), 1986),

('guest_user', 'guest@example.com', NULL,
 NULL, NULL, NULL, NULL,
 0, 0, 0, 0.0, '{}', NULL, NULL);

INSERT INTO posts (author_id, category_id, title, slug, excerpt, body, status, is_featured, is_pinned, view_count, like_count, comment_count, reading_time_min, word_count, cover_image, tags, meta, published_at) VALUES

(1, 3,
 'Understanding JSONB Indexes in PostgreSQL: A Practical Guide',
 'understanding-jsonb-indexes-postgresql',
 'JSONB in PostgreSQL is incredibly powerful, but unindexed JSONB queries can tank your performance. Here''s everything you need to know about GIN, GiST, and expression indexes on JSONB columns.',
 'Full article body here... [truncated for seed, would be 3000+ words covering GIN indexes, GiST indexes, expression indexes with jsonb_path_ops, containment operators @>, <@, and real-world benchmarks showing 100x speedup on a 10M row table]',
 'published', 1, 1, 18492, 847, 23, 14, 2800,
 'https://cdn.example.com/covers/jsonb-indexes.jpg',
 '["postgresql", "performance", "deep-dive"]',
 '{"og_title": "JSONB Indexes in PostgreSQL", "og_description": "A practical guide to indexing JSONB columns", "canonical": null, "noindex": false}',
 '2024-11-10 10:00:00'),

(1, 3,
 'SQLite is Not a Toy: Why I Use It in Production',
 'sqlite-not-a-toy-production',
 'SQLite handles 100k writes/second on commodity hardware, has ACID transactions, and ships in a single file. Here''s why it might be the right choice for your next project.',
 'Full article body here... [truncated for seed]',
 'published', 0, 0, 9241, 512, 14, 8, 1600,
 'https://cdn.example.com/covers/sqlite-production.jpg',
 '["sqlite", "performance"]',
 '{"og_title": "SQLite in Production", "og_description": "Why SQLite might be right for your project", "canonical": null}',
 '2024-11-22 09:00:00'),

(2, 2,
 'TypeScript Discriminated Unions Are Underrated',
 'typescript-discriminated-unions-underrated',
 'Pattern matching in TypeScript using discriminated unions is one of the most powerful patterns for modeling state. Here''s how to use them effectively.',
 'Full article body here... [truncated for seed]',
 'published', 0, 0, 5103, 298, 8, 6, 1200,
 NULL,
 '["typescript", "beginner"]',
 NULL,
 '2024-11-28 14:00:00'),

(3, 2,
 'The Hidden Cost of N+1 Queries (And How to Fix Them)',
 'hidden-cost-n-plus-1-queries',
 'N+1 queries are one of the most common and insidious performance problems in web applications. I''ve diagnosed hundreds of them. Here''s my mental model and fix playbook.',
 'Full article body here... [truncated for seed]',
 'published', 1, 0, 12847, 634, 31, 12, 2400,
 'https://cdn.example.com/covers/n-plus-1.jpg',
 '["postgresql", "performance", "deep-dive"]',
 '{"og_title": "N+1 Queries: The Full Guide", "og_description": "How to find and fix N+1 query problems"}',
 '2024-12-01 11:00:00'),

(4, 2,
 'Embedding Vectors in Postgres with pgvector: A Realistic Benchmark',
 'pgvector-realistic-benchmark',
 'I ran pgvector against Pinecone and Weaviate on 10M embeddings. The results surprised me. Here''s the full methodology and numbers.',
 'Full article body here... [truncated for seed]',
 'published', 1, 0, 7803, 445, 18, 11, 2200,
 'https://cdn.example.com/covers/pgvector-bench.jpg',
 '["postgresql", "performance", "deep-dive"]',
 '{"og_title": "pgvector Benchmark", "og_description": "Real-world pgvector performance vs hosted vector DBs"}',
 '2024-12-08 09:00:00'),

(1, 3,
 'Dendron: Building a SQL IDE in Tauri + Rust',
 'building-sql-ide-tauri-rust',
 'I got tired of TablePlus and DataGrip so I started building my own SQL IDE. Here''s what I''ve learned after 3 months of building with Tauri 2 and Rust on the backend.',
 'Full article body here... [truncated for seed]',
 'draft', 0, 0, 0, 0, 0, 18, 3600,
 NULL,
 '["rust", "typescript", "open-source"]',
 NULL,
 NULL),

(2, 5,
 'Designing Dark Mode That Doesn''t Suck',
 'designing-dark-mode-that-doesnt-suck',
 'Dark mode is everywhere, but most implementations are just "invert everything and call it a day." Here''s how to do it properly.',
 'Full article body here... [truncated for seed]',
 'published', 0, 0, 3912, 201, 9, 7, 1400,
 'https://cdn.example.com/covers/dark-mode.jpg',
 '["typescript", "beginner"]',
 NULL,
 '2024-12-10 15:00:00'),

(3, 4,
 'Zero-Downtime Postgres Migrations in 2024',
 'zero-downtime-postgres-migrations-2024',
 'Adding a column with a default value locks your table. Adding a NOT NULL constraint locks your table. Here''s how to run every common migration with zero downtime.',
 'Full article body here... [truncated for seed]',
 'scheduled', 0, 0, 0, 0, 0, 16, 3200,
 'https://cdn.example.com/covers/pg-migrations.jpg',
 '["postgresql", "performance", "deep-dive"]',
 '{"og_title": "Zero-Downtime Postgres Migrations"}',
 NULL);

-- post_tags junction
INSERT INTO post_tags (post_id, tag_id) VALUES
(1, 3), (1, 5), (1, 7),   -- jsonb post: postgresql, performance, deep-dive
(2, 4), (2, 5),            -- sqlite post: sqlite, performance
(3, 2), (3, 6),            -- ts post: typescript, beginner
(4, 3), (4, 5), (4, 7),   -- n+1 post: postgresql, performance, deep-dive
(5, 3), (5, 5), (5, 7),   -- pgvector post
(6, 1), (6, 2), (6, 8),   -- dendron post: rust, typescript, open-source
(7, 2), (7, 6),            -- dark mode: typescript, beginner
(8, 3), (8, 7);            -- migrations: postgresql, deep-dive

INSERT INTO comments (post_id, author_id, parent_id, guest_name, guest_email, body, is_approved, ip_address) VALUES
(1, 2, NULL, NULL, NULL,
 'Great write-up! One thing worth adding: for write-heavy workloads, GIN indexes can slow down inserts significantly. Did you measure that in your benchmarks?',
 1, '198.51.100.77'),
(1, NULL, NULL, 'Random Internet Person', 'anon@example.com',
 'This saved my production app. Was doing a full table scan on a 50M row jsonb column. GIN index brought it from 40s to 8ms. You are a legend.',
 1, '203.0.113.200'),
(1, 3, 1, NULL, NULL,
 'Good point Bob. GIN write amplification is real. Rule of thumb: if your write rate on that column is >1k/s, measure before you commit to GIN.',
 1, '192.0.2.100'),
(1, NULL, NULL, 'Lurker #4421', NULL,
 'spam spam buy cheap software',
 0, '10.0.0.1'),
(4, 4, NULL, NULL, NULL,
 'The section on DataLoader patterns is particularly good. I''d add that in GraphQL specifically, the N+1 problem is almost guaranteed without batching — the resolver model makes it trivial to accidentally issue a query per node.',
 1, '203.0.113.202'),
(4, 2, NULL, NULL, NULL,
 'I''ve been bitten by this so many times with Prisma. The include syntax makes it feel like you''re doing eager loading but it''s still N+1 under the hood in certain cases.',
 1, '198.51.100.77'),
(5, 1, NULL, NULL, NULL,
 'Pinned this to our Slack channel. Very relevant as we''re evaluating pgvector for our RAG pipeline. The HNSW vs IVFFlat section was especially useful.',
 1, '203.0.113.42');

INSERT INTO media (uploader_id, filename, original_name, mime_type, size_bytes, width, height, duration_s, checksum, thumbnail, alt_text, caption, exif, storage_path, cdn_url, is_public) VALUES
(1, 'jsonb-indexes-cover-1731232800.jpg', 'cover-final.jpg', 'image/jpeg',
 284921, 1200, 630, NULL,
 'a1b2c3d4e5f6789012345678901234ab',
 X'FFD8FFE000104A46494600010100',   -- BLOB: fake JPEG header bytes
 'Abstract visualization of a tree index structure in blue and purple',
 'GIN index visualization — dendron blog',
 '{"camera": null, "taken_at": null, "gps": null}',
 'uploads/2024/11/jsonb-indexes-cover-1731232800.jpg',
 'https://cdn.example.com/covers/jsonb-indexes.jpg', 1),

(1, 'alice-avatar-1.jpg', 'photo.jpg', 'image/jpeg',
 48203, 400, 400, NULL,
 'deadbeef12345678deadbeef12345678',
 X'FFD8FFE0',
 'Alice Johnson profile photo',
 NULL,
 '{"camera": "iPhone 15 Pro", "taken_at": "2024-06-15T14:22:00"}',
 'uploads/avatars/alice-avatar-1.jpg',
 'https://cdn.example.com/avatars/alice.jpg', 1),

(3, 'postgres-explain-screenshot.png', 'explain-analyze-output.png', 'image/png',
 92441, 1440, 900, NULL,
 '0102030405060708090a0b0c0d0e0f10',
 NULL,
 'EXPLAIN ANALYZE output showing a sequential scan on orders table',
 'Before optimization: Seq Scan, 4.2s',
 '{"software": "Dendron SQL IDE", "captured_at": "2024-11-30T09:15:00"}',
 'uploads/2024/11/postgres-explain-screenshot.png',
 'https://cdn.example.com/posts/postgres-explain-screenshot.png', 1),

(4, 'benchmark-results.mp4', 'pgvector-benchmark-recording.mp4', 'video/mp4',
 18483920, 1920, 1080, 184.5,
 'aabbccddeeff00112233445566778899',
 NULL,
 'Screen recording of benchmark run comparing pgvector vs Pinecone',
 NULL,
 '{}',
 'uploads/2024/12/benchmark-results.mp4',
 NULL, 0);  -- private video, not yet published

INSERT INTO site_settings (key, value, value_type, description, is_public) VALUES
('site_name',         'The Dendron Blog',          'string',  'Public site name',                            1),
('site_tagline',      'Building in public',        'string',  'Short tagline shown in header',               1),
('posts_per_page',    '10',                        'integer', 'Number of posts per listing page',            0),
('enable_comments',   'true',                      'boolean', 'Whether comments are enabled sitewide',       0),
('akismet_key',       NULL,                        'null',    'Akismet spam API key (unset)',                0),
('theme_config',      '{"primary_color": "#60a5fa", "font_body": "Geist", "font_mono": "Geist Mono", "sidebar": true}',
                                                   'json',    'Active theme configuration',                  0),
('analytics_id',      'G-XXXXXXXXXXXX',            'string',  'Google Analytics measurement ID',             0),
('max_upload_mb',     '25',                        'integer', 'Max file upload size in megabytes',           0),
('maintenance_mode',  'false',                     'boolean', 'Put site in maintenance mode',                0),
('og_image',          'https://cdn.example.com/og-default.jpg', 'string', 'Default OG image URL',           1),
('rss_items',         '20',                        'integer', 'Number of items in RSS feed',                 1),
('smtp_host',         'smtp.postmarkapp.com',      'string',  'SMTP server hostname',                        0),
('smtp_port',         '587',                       'integer', 'SMTP server port',                            0),
('allow_registration','true',                      'boolean', 'Whether new registrations are open',          0),
('featured_post_id',  '1',                         'integer', 'ID of pinned/featured post on homepage',      0);

-- page views: mix of post views and direct path views
INSERT INTO page_views (post_id, session_id, path, referrer, country, device, browser, duration_s, viewed_at) VALUES
(1, 'sess_abc123', '/understanding-jsonb-indexes-postgresql', 'https://google.com', 'US', 'desktop', 'Chrome',  342.5, unixepoch('2024-12-15 09:23:00')),
(1, 'sess_abc123', '/understanding-jsonb-indexes-postgresql', 'https://google.com', 'US', 'desktop', 'Chrome',  NULL,  unixepoch('2024-12-15 09:24:00')),
(4, 'sess_def456', '/hidden-cost-n-plus-1-queries',           'https://hn.algolia.com', 'DE', 'desktop', 'Firefox', 621.0, unixepoch('2024-12-15 10:01:00')),
(5, 'sess_ghi789', '/pgvector-realistic-benchmark',           NULL, 'GB', 'desktop', 'Safari', 891.2, unixepoch('2024-12-15 10:15:00')),
(2, 'sess_jkl012', '/sqlite-not-a-toy-production',            'https://reddit.com/r/programming', 'CA', 'mobile', 'Safari', 180.0, unixepoch('2024-12-15 11:00:00')),
(NULL, 'sess_mno345', '/',                                    NULL, 'US', 'desktop', 'Chrome', 45.2, unixepoch('2024-12-15 11:30:00')),
(1, 'sess_pqr678', '/understanding-jsonb-indexes-postgresql', 'https://news.ycombinator.com', 'AU', 'desktop', 'Arc', 1200.0, unixepoch('2024-12-15 12:00:00')),
(3, 'sess_stu901', '/typescript-discriminated-unions-underrated', 'https://twitter.com', 'US', 'mobile', 'Chrome', 240.5, unixepoch('2024-12-15 12:30:00')),
(4, 'sess_vwx234', '/hidden-cost-n-plus-1-queries',           'https://google.com', 'US', 'tablet', 'Safari', NULL, unixepoch('2024-12-15 13:00:00')),
(NULL, 'sess_yza567', '/tags/postgresql',                     NULL, 'NL', 'desktop', 'Firefox', 28.1, unixepoch('2024-12-15 13:45:00'));
