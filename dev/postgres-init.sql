-- ============================================================
-- dendron dev database — PostgreSQL 16
-- Covers: uuid, serial/bigserial, smallint, int, bigint,
--         numeric, real, double precision, money, boolean,
--         varchar, char, text, bytea,
--         timestamptz, timestamp (no tz), date, time, interval,
--         jsonb, json, text[], integer[], inet,
--         enum, generated columns, check constraints, FKs
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enum types ───────────────────────────────────────────────
CREATE TYPE user_status   AS ENUM ('active', 'inactive', 'suspended', 'pending');
CREATE TYPE order_status  AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE movement_type AS ENUM ('inbound', 'outbound', 'transfer', 'adjustment');
CREATE TYPE priority      AS ENUM ('low', 'medium', 'high', 'critical');


-- ════════════════════════════════════════════════════════════
-- Schema: public
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.users (
    id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    username         varchar(50)     NOT NULL UNIQUE,
    email            text            NOT NULL UNIQUE,
    display_name     varchar(100),
    status           user_status     NOT NULL DEFAULT 'active',
    age              smallint        CHECK (age > 0 AND age < 150),
    score            double precision NOT NULL DEFAULT 0.0,
    balance          numeric(12, 2)  NOT NULL DEFAULT 0.00,
    is_verified      boolean         NOT NULL DEFAULT false,
    metadata         jsonb,
    preferences      jsonb           NOT NULL DEFAULT '{}',
    tags             text[],
    last_ip          inet,
    bio              text,
    avatar           bytea,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now(),
    last_login_at    timestamptz,
    birth_date       date,
    wakeup_time      time,
    session_duration interval
);

CREATE TABLE public.products (
    id               serial          PRIMARY KEY,
    sku              varchar(32)     NOT NULL UNIQUE,
    name             varchar(255)    NOT NULL,
    description      text,
    price            numeric(10, 2)  NOT NULL,
    sale_price       numeric(10, 2),
    cost             money,
    weight_kg        real,
    is_active        boolean         NOT NULL DEFAULT true,
    category         varchar(50),
    attributes       jsonb           NOT NULL DEFAULT '{}',
    images           text[],
    tag_ids          integer[],
    stock_count      integer         NOT NULL DEFAULT 0,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
    id               bigserial       PRIMARY KEY,
    reference        varchar(20)     NOT NULL UNIQUE,
    user_id          uuid            NOT NULL REFERENCES public.users(id),
    status           order_status    NOT NULL DEFAULT 'pending',
    subtotal         numeric(12, 2)  NOT NULL,
    tax              numeric(12, 2)  NOT NULL DEFAULT 0,
    shipping         numeric(12, 2)  NOT NULL DEFAULT 0,
    total            numeric(12, 2)  NOT NULL,
    currency         char(3)         NOT NULL DEFAULT 'USD',
    shipping_addr    jsonb,
    billing_addr     jsonb,
    notes            text,
    metadata         jsonb,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now(),
    shipped_at       timestamptz,
    delivered_at     timestamptz,
    cancelled_at     timestamp                           -- intentionally WITHOUT time zone
);

CREATE TABLE public.order_items (
    id               bigserial       PRIMARY KEY,
    order_id         bigint          NOT NULL REFERENCES public.orders(id),
    product_id       integer         NOT NULL REFERENCES public.products(id),
    quantity         integer         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price       numeric(10, 2)  NOT NULL,
    discount         numeric(5, 2)   NOT NULL DEFAULT 0.00,
    subtotal         numeric(10, 2)  NOT NULL,
    attributes       jsonb
);

CREATE TABLE public.tags (
    id               serial          PRIMARY KEY,
    name             varchar(50)     NOT NULL UNIQUE,
    slug             varchar(50)     NOT NULL UNIQUE,
    color            char(7),
    description      text,
    created_at       timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
    id               bigserial       PRIMARY KEY,
    table_name       varchar(100)    NOT NULL,
    record_id        text            NOT NULL,
    action           varchar(10)     NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values       jsonb,
    new_values       jsonb,
    changed_by       uuid            REFERENCES public.users(id),
    changed_at       timestamptz     NOT NULL DEFAULT now(),
    ip_address       inet,
    user_agent       text
);


-- ════════════════════════════════════════════════════════════
-- Schema: analytics
-- ════════════════════════════════════════════════════════════

CREATE SCHEMA analytics;

CREATE TABLE analytics.events (
    id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid            REFERENCES public.users(id),
    session_id       uuid,
    event_type       varchar(50)     NOT NULL,
    event_name       varchar(100)    NOT NULL,
    payload          jsonb           NOT NULL DEFAULT '{}',
    properties       jsonb,
    ip_address       inet,
    user_agent       text,
    occurred_at      timestamptz     NOT NULL DEFAULT now(),
    processed_at     timestamp,                          -- WITHOUT time zone, intentional
    is_processed     boolean         NOT NULL DEFAULT false
);

CREATE TABLE analytics.sessions (
    id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid            REFERENCES public.users(id),
    started_at       timestamptz     NOT NULL DEFAULT now(),
    ended_at         timestamptz,
    duration         interval GENERATED ALWAYS AS (ended_at - started_at) STORED,
    page_count       integer         NOT NULL DEFAULT 0,
    referrer         text,
    utm_source       varchar(100),
    utm_medium       varchar(100),
    utm_campaign     varchar(100),
    device_type      varchar(20),
    browser          varchar(50),
    country_code     char(2),
    metadata         jsonb
);

CREATE TABLE analytics.daily_metrics (
    id               serial          PRIMARY KEY,
    metric_date      date            NOT NULL,
    metric_name      varchar(100)    NOT NULL,
    metric_value     double precision NOT NULL,
    dimensions       jsonb           NOT NULL DEFAULT '{}',
    created_at       timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (metric_date, metric_name, dimensions)
);

CREATE TABLE analytics.feature_flags (
    id               serial          PRIMARY KEY,
    flag_key         varchar(100)    NOT NULL UNIQUE,
    description      text,
    is_enabled       boolean         NOT NULL DEFAULT false,
    rollout_pct      real            NOT NULL DEFAULT 0.0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
    targeting_rules  jsonb           NOT NULL DEFAULT '[]',
    variants         jsonb,
    enabled_at       timestamptz,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════
-- Schema: inventory
-- ════════════════════════════════════════════════════════════

CREATE SCHEMA inventory;

CREATE TABLE inventory.warehouses (
    id               serial          PRIMARY KEY,
    code             varchar(10)     NOT NULL UNIQUE,
    name             varchar(100)    NOT NULL,
    address          jsonb,
    is_active        boolean         NOT NULL DEFAULT true,
    created_at       timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE inventory.stock_levels (
    id               bigserial       PRIMARY KEY,
    warehouse_id     integer         NOT NULL REFERENCES inventory.warehouses(id),
    product_id       integer         NOT NULL REFERENCES public.products(id),
    quantity         integer         NOT NULL DEFAULT 0,
    reserved         integer         NOT NULL DEFAULT 0,
    reorder_point    integer,
    updated_at       timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (warehouse_id, product_id)
);

CREATE TABLE inventory.movements (
    id               bigserial       PRIMARY KEY,
    warehouse_id     integer         NOT NULL REFERENCES inventory.warehouses(id),
    product_id       integer         NOT NULL REFERENCES public.products(id),
    movement_type    movement_type   NOT NULL,
    quantity         integer         NOT NULL,
    reference_id     bigint,
    notes            text,
    moved_at         timestamptz     NOT NULL DEFAULT now(),
    moved_by         uuid            REFERENCES public.users(id)
);


-- ════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════

-- ─── Tags ─────────────────────────────────────────────────────
INSERT INTO public.tags (name, slug, color, description) VALUES
    ('Featured',    'featured',    '#F59E0B', 'Curated highlighted products'),
    ('Sale',        'sale',        '#EF4444', 'Currently discounted'),
    ('New Arrival', 'new-arrival', '#10B981', 'Added in the last 30 days'),
    ('Best Seller', 'best-seller', '#6366F1', 'Top 10% by revenue'),
    ('Clearance',   'clearance',   '#F97316', 'End of line, deep discount'),
    ('Premium',     'premium',     '#8B5CF6', 'Top-tier quality products'),
    ('Eco',         'eco',         '#22C55E', 'Sustainable / low carbon'),
    ('Limited',     'limited',     '#EC4899', 'Limited run, while stock lasts'),
    ('Digital',     'digital',     '#0EA5E9', 'Software / digital delivery'),
    ('Bundle',      'bundle',      '#A78BFA', 'Multi-item bundle deal');


-- ─── Users ────────────────────────────────────────────────────
INSERT INTO public.users (username, email, display_name, status, age, score, balance, is_verified, metadata, preferences, tags, last_ip, bio, last_login_at, birth_date, wakeup_time, session_duration) VALUES

('alice_j', 'alice@example.com', 'Alice Johnson', 'active', 32, 4850.5, 1250.00, true,
 '{"plan": "pro", "referral_code": "ALICE2024", "signup_source": "organic", "ab_cohort": "B"}',
 '{"theme": "dark", "language": "en", "notifications": {"email": true, "push": false}, "density": "compact"}',
 ARRAY['premium', 'beta-tester'],
 '203.0.113.42',
 'Senior engineer turned product manager. Coffee addict. I build things on the internet, mostly in TypeScript and Rust. Previously at a few startups you haven''t heard of.',
 '2024-12-15 09:23:11+00', '1992-03-14', '07:30:00', '2 hours 15 minutes'),

('bob_smith', 'bob@example.com', 'Bob Smith', 'active', 28, 1200.0, 450.50, true,
 '{"plan": "free", "referral_code": null, "signup_source": "google"}',
 '{"theme": "light", "language": "en", "notifications": {"email": true, "push": true}}',
 ARRAY['new-arrival'],
 '198.51.100.77',
 'Frontend developer. React, Vue, whatever pays.',
 '2024-12-14 14:55:00+00', '1996-07-22', '08:00:00', '45 minutes'),

('carol_w', 'carol@company.org', 'Carol Williams', 'active', 41, 9200.0, 8750.25, true,
 '{"plan": "enterprise", "company": "Acme Corp", "seats": 12, "contract_end": "2025-06-30"}',
 '{"theme": "dark", "language": "fr", "notifications": {"email": false, "push": false}, "compact_mode": true, "timezone": "Europe/Paris"}',
 ARRAY['premium', 'enterprise'],
 '192.0.2.100',
 NULL,
 '2024-12-15 11:00:00+00', '1983-11-05', '06:00:00', '8 hours'),

('dave_k', 'dave@example.com', 'Dave Kim', 'active', 25, 300.0, 0.00, false,
 NULL,
 '{"theme": "system"}',
 NULL,
 '10.0.0.55',
 NULL,
 '2024-11-20 18:30:00+00', '1999-04-17', NULL, NULL),

('eve_m', 'eve@startup.io', 'Eve Martinez', 'active', 35, 5650.75, 3200.00, true,
 '{"plan": "pro", "github": "evem", "twitter": "@evem_dev", "website": "https://eve.dev"}',
 '{"theme": "dark", "language": "es", "notifications": {"email": true, "push": true}, "editor_font": "Geist Mono"}',
 ARRAY['beta-tester', 'premium'],
 '203.0.113.88',
 'Open source contributor. Building developer tools full-time. Ex-FAANG. I write about distributed systems and database internals at eve.dev.',
 '2024-12-15 08:45:00+00', '1989-09-30', '06:30:00', '3 hours 30 minutes'),

('frank_t', 'frank@example.com', 'Frank Thompson', 'inactive', 55, 120.0, 75.00, true,
 '{"plan": "free", "last_active_reason": "vacation", "reactivation_email_sent": "2024-11-01"}',
 '{"theme": "light", "language": "en"}',
 NULL,
 NULL,
 'Retired teacher, learning to code at 55. Taking it one day at a time.',
 '2024-09-01 12:00:00+00', '1969-12-25', '09:00:00', NULL),

('grace_l', 'grace@example.com', 'Grace Lee', 'active', 29, 2100.0, 890.00, true,
 '{"plan": "pro", "referral_code": "GRACE50", "signup_source": "twitter"}',
 '{"theme": "dark", "language": "zh", "notifications": {"email": true, "push": true}, "locale": "zh-TW", "timezone": "Asia/Taipei"}',
 ARRAY['new-arrival', 'beta-tester'],
 '203.0.113.12',
 'Data scientist by day, baker by night. Pandas, PyTorch, sourdough.',
 '2024-12-15 07:12:00+00', '1995-06-10', '07:00:00', '1 hour 20 minutes'),

('henry_b', 'henry@bigcorp.com', 'Henry Brown', 'active', 48, 7800.0, 15000.00, true,
 '{"plan": "enterprise", "company": "BigCorp Inc", "department": "Engineering", "employee_id": "EMP-4421", "cost_center": "CC-7700"}',
 '{"theme": "light", "language": "en", "notifications": {"email": true, "push": false}, "2fa_enabled": true}',
 ARRAY['enterprise', 'premium'],
 '192.0.2.200',
 'VP of Engineering at BigCorp. 20+ years in the industry. Opinions are my own.',
 '2024-12-15 13:45:00+00', '1976-02-28', '05:45:00', '10 hours'),

('iris_n', 'iris@example.com', 'Iris Nakamura', 'pending', 22, 0.0, 0.00, false,
 '{"plan": "free", "signup_source": "referral", "referrer": "alice_j", "verification_sent_at": "2024-12-14T10:00:00Z"}',
 '{}',
 NULL,
 '198.51.100.3',
 NULL,
 NULL, '2002-08-14', NULL, NULL),

('jack_p', 'jack@example.com', 'Jack Peterson', 'suspended', 31, 50.0, 0.00, true,
 '{"plan": "free", "suspension_reason": "payment_fraud", "suspended_at": "2024-10-15", "appeal_status": null}',
 '{"theme": "dark"}',
 NULL,
 '10.0.0.99',
 NULL,
 '2024-10-14 23:55:00+00', '1993-01-08', NULL, NULL),

('kelly_r', 'kelly@design.co', 'Kelly Rodriguez', 'active', 34, 3400.0, 2100.00, true,
 '{"plan": "pro", "portfolio": "https://kelly.design", "dribbble": "kellyrod", "behance": "kelly_rodriguez"}',
 '{"theme": "dark", "language": "en", "notifications": {"email": true, "push": true}, "grid_view": true}',
 ARRAY['premium', 'featured'],
 '203.0.113.55',
 'UX designer with 10 years of experience. Obsessed with pixels, typography, and motion. Currently available for freelance.',
 '2024-12-14 16:20:00+00', '1990-05-19', '08:30:00', '2 hours 45 minutes'),

('liam_o', 'liam@example.com', NULL, 'active', 19, 25.0, 10.00, false,
 '{"plan": "free"}',
 '{"theme": "system", "language": "en"}',
 NULL,
 '192.0.2.77',
 NULL,
 '2024-12-10 20:00:00+00', '2005-03-03', NULL, NULL),

('maya_s', 'maya@research.edu', 'Maya Singh', 'active', 38, 6100.0, 4500.00, true,
 '{"plan": "pro", "institution": "MIT", "research_area": "ML/AI", "google_scholar": "maya_singh_ml", "h_index": 14}',
 '{"theme": "dark", "language": "en", "notifications": {"email": false, "push": false}, "latex_mode": true}',
 ARRAY['premium', 'beta-tester'],
 '203.0.113.202',
 'ML researcher. Interested in LLMs, graph neural networks, and interpretability. Occasionally blogs about things that confuse me.',
 '2024-12-15 10:30:00+00', '1986-10-12', '06:45:00', '4 hours 15 minutes'),

('noah_c', 'noah@example.com', 'Noah Chen', 'active', 26, 780.0, 350.00, true,
 '{"plan": "free", "github": "noahc", "signup_source": "github_oauth"}',
 '{"theme": "dark", "language": "en", "vim_mode": true}',
 ARRAY['new-arrival'],
 '10.0.0.123',
 'Junior developer. Still figuring it all out.',
 '2024-12-13 09:00:00+00', '1998-11-27', '08:15:00', '30 minutes'),

('olivia_f', 'olivia@agency.com', 'Olivia Foster', 'active', 43, 8900.0, 12000.00, true,
 '{"plan": "enterprise", "company": "Digital Agency X", "team_size": 25, "annual_spend_usd": 49800}',
 '{"theme": "light", "language": "en", "notifications": {"email": true, "push": false}, "timezone": "America/New_York", "week_starts": "monday"}',
 ARRAY['enterprise', 'premium', 'featured'],
 '203.0.113.99',
 'CEO of Digital Agency X. 15 years in digital marketing and product development. Speaker, occasional writer.',
 '2024-12-15 14:10:00+00', '1981-07-04', '05:30:00', '12 hours 30 minutes');


-- ─── Products ─────────────────────────────────────────────────
INSERT INTO public.products (sku, name, description, price, sale_price, cost, weight_kg, is_active, category, attributes, images, tag_ids, stock_count) VALUES

('KB-001', 'Mechanical Keyboard Pro',
 'Full-size mechanical keyboard with Cherry MX Red switches, per-key RGB backlight, and aircraft-grade aluminum frame. 1000Hz polling rate, N-key rollover, USB-C detachable cable.',
 149.99, 129.99, '$89.00'::money, 1.20, true, 'peripherals',
 '{"switches": "Cherry MX Red", "layout": "full-size", "keys": 104, "backlight": "RGB per-key", "connectivity": "USB-C", "polling_rate_hz": 1000, "n_key_rollover": true, "onboard_memory": true}',
 ARRAY['https://cdn.example.com/kb-001-front.jpg', 'https://cdn.example.com/kb-001-angle.jpg', 'https://cdn.example.com/kb-001-close.jpg'],
 ARRAY[1, 4], 143),

('KB-002', 'Wireless Compact Keyboard',
 'Compact 75% wireless keyboard with Bluetooth 5.0 and 2.4GHz USB receiver. 40-hour battery, hot-swap PCB, south-facing RGB.',
 89.99, NULL, '$52.00'::money, 0.70, true, 'peripherals',
 '{"switches": "Gateron Brown", "layout": "75%", "keys": 84, "backlight": "RGB", "connectivity": ["Bluetooth 5.0", "2.4GHz USB"], "battery_hours": 40, "hot_swap": true}',
 ARRAY['https://cdn.example.com/kb-002-top.jpg', 'https://cdn.example.com/kb-002-side.jpg'],
 ARRAY[3], 89),

('MS-001', 'Ergonomic Vertical Mouse',
 'Vertical ergonomic mouse designed to reduce wrist and forearm strain. 6 programmable buttons, adjustable DPI up to 4000, silent click switches.',
 59.99, 49.99, '$28.50'::money, 0.15, true, 'peripherals',
 '{"dpi_range": [800, 1200, 2400, 4000], "buttons": 6, "connectivity": "USB-A 2.4GHz", "ergonomic": true, "hand": "right", "silent_clicks": true}',
 ARRAY['https://cdn.example.com/ms-001-side.jpg', 'https://cdn.example.com/ms-001-top.jpg'],
 ARRAY[1, 2], 267),

('MS-002', 'Gaming Mouse Pro',
 'Ultra-lightweight gaming mouse at 58g with honeycomb shell. PixArt PAW3395 sensor, 25600 DPI, 1000Hz polling, PTFE feet, ambidextrous design.',
 79.99, NULL, '$42.00'::money, 0.058, true, 'peripherals',
 '{"dpi_max": 25600, "buttons": 8, "weight_g": 58, "rgb": true, "polling_rate_hz": 1000, "sensor": "PixArt PAW3395", "feet": "PTFE", "ambidextrous": true, "shell": "honeycomb"}',
 ARRAY['https://cdn.example.com/ms-002-black.jpg', 'https://cdn.example.com/ms-002-white.jpg'],
 ARRAY[4], 54),

('MN-001', '27" 4K IPS Monitor',
 '27-inch 4K UHD IPS display with 144Hz refresh rate, factory-calibrated to Delta-E < 2, HDR400, USB-C 65W power delivery, KVM switch.',
 599.99, 549.99, '$380.00'::money, 6.80, true, 'displays',
 '{"resolution": "3840x2160", "refresh_rate_hz": 144, "panel_type": "IPS", "hdr": "HDR400", "delta_e": "< 2", "ports": ["USB-C 65W", "HDMI 2.1", "DisplayPort 1.4", "USB-A x3"], "vesa": "100x100", "kvm": true, "size_inches": 27}',
 ARRAY['https://cdn.example.com/mn-001-front.jpg', 'https://cdn.example.com/mn-001-rear.jpg'],
 ARRAY[1, 6], 32),

('MN-002', '34" Ultrawide Curved Monitor',
 '34-inch curved ultrawide 1440p VA panel, 165Hz, G-Sync Compatible, 1ms MPRT. Wide color gamut 125% sRGB, HDR600, PiP/PbP support.',
 849.99, NULL, '$520.00'::money, 9.20, true, 'displays',
 '{"resolution": "3440x1440", "refresh_rate_hz": 165, "panel_type": "VA", "curvature": "1500R", "gsync_compatible": true, "hdr": "HDR600", "color_gamut_srgb_pct": 125, "ports": ["HDMI 2.0 x2", "DisplayPort 1.4"], "pip_pbp": true, "size_inches": 34}',
 ARRAY['https://cdn.example.com/mn-002-front.jpg'],
 ARRAY[6], 18),

('ST-001', 'Dual Monitor Arm',
 'Dual monitor arm with full gas-spring articulation, integrated cable management, VESA 75/100 compatible. Holds up to 9kg per screen, desk clamp or grommet mount.',
 119.99, 99.99, '$65.00'::money, 4.50, true, 'accessories',
 '{"monitors": 2, "max_weight_per_arm_kg": 9, "vesa": ["75x75", "100x100"], "adjustments": ["tilt", "swivel", "height", "rotation", "extension"], "mount": ["clamp", "grommet"]}',
 ARRAY['https://cdn.example.com/st-001.jpg'],
 ARRAY[1], 76),

('HB-001', 'USB-C 12-in-1 Dock',
 '12-in-1 USB-C docking station. 4K60 HDMI, 100W PD pass-through, 2.5Gbps Ethernet, SD 4.0 + microSD, 4x USB-A, 2x USB-C data, 3.5mm audio.',
 69.99, 59.99, '$35.00'::money, 0.18, true, 'accessories',
 '{"ports": {"usb_c_pd_w": 100, "usb_c_data": 2, "usb_a": 4, "hdmi": "4K@60Hz", "sd_card": "UHS-II", "microsd": true, "ethernet_gbps": 2.5, "audio_jack": true}, "chipset": "VL822"}',
 ARRAY['https://cdn.example.com/hb-001.jpg'],
 ARRAY[1, 3], 198),

('HD-001', 'Wireless Noise-Cancelling Headphones',
 'Over-ear wireless headphones with 40dB hybrid ANC, 30-hour battery (60hr ANC off), foldable design, multipoint connection for 2 devices simultaneously.',
 249.99, 199.99, '$140.00'::money, 0.28, true, 'audio',
 '{"anc_db": 40, "anc_type": "hybrid", "battery_hours_anc_on": 30, "battery_hours_anc_off": 60, "driver_mm": 40, "bluetooth_version": "5.2", "codecs": ["AAC", "SBC", "LDAC"], "multipoint": true, "foldable": true, "mic": true}',
 ARRAY['https://cdn.example.com/hd-001-black.jpg', 'https://cdn.example.com/hd-001-silver.jpg', 'https://cdn.example.com/hd-001-navy.jpg'],
 ARRAY[1, 6], 156),

('HD-002', 'Open-Back Studio Headphones',
 'Professional open-back studio headphones, 250Ω impedance, flat reference response for mixing and mastering. Velour ear pads, replaceable cable, comes with 3.5mm and 6.35mm adapters.',
 179.99, NULL, '$95.00'::money, 0.32, true, 'audio',
 '{"impedance_ohm": 250, "sensitivity_db_spl": 96, "driver_mm": 45, "open_back": true, "frequency_hz": [5, 35000], "cable_m": 3, "ear_pads": "velour", "replaceable_cable": true}',
 ARRAY['https://cdn.example.com/hd-002.jpg'],
 ARRAY[6], 42),

('WC-001', '4K Webcam Pro',
 '4K 30fps / 1080p 60fps webcam with Sony STARVIS low-light sensor, dual noise-cancelling mics, adjustable FOV (65°/78°/90°), privacy shutter, works with OBS/Zoom/Teams.',
 129.99, 109.99, '$72.00'::money, 0.22, true, 'peripherals',
 '{"resolution": "4K@30fps", "sensor": "Sony STARVIS IMX415", "fov_options_deg": [65, 78, 90], "microphone": "dual noise-cancelling", "autofocus": "AI-powered", "hdr": true, "privacy_shutter": true, "compatibility": ["OBS", "Zoom", "Teams", "Meet"]}',
 ARRAY['https://cdn.example.com/wc-001.jpg'],
 ARRAY[1, 3], 91),

('DC-001', 'Desk Pad XL',
 'Extra-large 90×45cm desk pad. Premium microfiber surface, water-resistant coating, stitched edges, non-slip rubber base. Available in black and grey.',
 39.99, NULL, '$18.00'::money, 0.60, true, 'accessories',
 '{"dimensions_cm": [90, 45], "thickness_mm": 4, "material": "microfiber", "water_resistant": true, "stitched_edges": true, "base": "non-slip rubber"}',
 ARRAY['https://cdn.example.com/dc-001-black.jpg', 'https://cdn.example.com/dc-001-grey.jpg'],
 ARRAY[3], 312),

('LT-001', 'Smart LED Desk Lamp',
 'Smart LED desk lamp with 10W Qi wireless charging base. Touch dimmer, 5 color temperatures (2700K–6500K), app control via Bluetooth, eye-care diffused light, USB-A charging port.',
 79.99, 69.99, '$38.00'::money, 1.10, true, 'accessories',
 '{"lumens_max": 1200, "color_temp_k": [2700, 3000, 4000, 5000, 6500], "wireless_charging_w": 10, "usb_a_ports": 1, "bluetooth": true, "app_control": true, "eye_care_mode": true, "dimmer": "touch"}',
 ARRAY['https://cdn.example.com/lt-001-white.jpg', 'https://cdn.example.com/lt-001-black.jpg'],
 ARRAY[1, 3], 128),

('CH-001', 'Ergonomic Mesh Chair',
 'Fully adjustable ergonomic office chair. Breathable mesh back, contoured lumbar support, 4D armrests, adjustable seat depth and tilt tension, headrest included. Supports up to 150kg. 5-year warranty.',
 449.99, 399.99, '$260.00'::money, 22.0, true, 'furniture',
 '{"material": "mesh", "lumbar_support": "adjustable", "headrest": true, "armrests": "4D", "seat_height_cm": [42, 54], "seat_depth_adjustable": true, "tilt_tension_adjustable": true, "max_weight_kg": 150, "warranty_years": 5}',
 ARRAY['https://cdn.example.com/ch-001-black.jpg', 'https://cdn.example.com/ch-001-grey.jpg'],
 ARRAY[1, 6], 24),

('DK-001', 'Electric Standing Desk',
 'Electric height-adjustable standing desk with 160×80cm solid bamboo top. Dual whisper-quiet motors, 4-preset memory, anti-collision system, built-in cable tray. 80kg load capacity.',
 699.99, NULL, '$420.00'::money, 45.0, true, 'furniture',
 '{"top_dimensions_cm": [160, 80], "top_material": "bamboo", "height_range_cm": [62, 128], "motors": "dual", "noise_db": 45, "presets": 4, "anti_collision": true, "cable_tray": true, "load_capacity_kg": 80}',
 ARRAY['https://cdn.example.com/dk-001-natural.jpg', 'https://cdn.example.com/dk-001-black.jpg'],
 ARRAY[7], 11),

('SW-001', 'Developer Toolkit — Annual',
 'Annual subscription to Developer Toolkit. Includes unlimited API calls, advanced analytics dashboard, team workspace with up to 10 seats, priority support SLA (4h response), and access to all beta features.',
 199.99, NULL, NULL, NULL, true, 'software',
 '{"type": "subscription", "billing": "annual", "api_calls": "unlimited", "seats": 10, "support_sla_hours": 4, "features": ["priority_support", "team_workspace", "advanced_analytics", "beta_access", "audit_log", "sso"]}',
 ARRAY[]::text[],
 ARRAY[9], 9999);


-- ─── Orders ───────────────────────────────────────────────────
INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, billing_addr, notes, metadata, created_at, updated_at, shipped_at, delivered_at, cancelled_at)

SELECT 'ORD-2024-0001', id, 'delivered', 149.99, 12.75, 9.99, 172.73, 'USD',
 '{"name": "Alice Johnson", "street": "123 Main St", "city": "San Francisco", "state": "CA", "zip": "94105", "country": "US", "phone": "+14155550100"}',
 '{"name": "Alice Johnson", "street": "123 Main St", "city": "San Francisco", "state": "CA", "zip": "94105", "country": "US"}',
 NULL, '{"payment_method": "card_visa", "last4": "4242", "ip": "203.0.113.42"}',
 '2024-10-01 10:30:00+00', '2024-10-05 14:20:00+00', '2024-10-03 09:00:00+00', '2024-10-05 14:20:00+00', NULL
FROM public.users WHERE username = 'alice_j';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at, delivered_at)
SELECT 'ORD-2024-0002', id, 'delivered', 549.99, 46.75, 0.00, 596.74, 'USD',
 '{"name": "Alice Johnson", "street": "123 Main St", "city": "San Francisco", "state": "CA", "zip": "94105", "country": "US"}',
 'Please leave at door if no answer',
 '{"payment_method": "card_amex", "last4": "1001", "promo_code": "SAVE10", "promo_discount": 50.00}',
 '2024-10-15 15:45:00+00', '2024-10-20 11:00:00+00', '2024-10-17 08:30:00+00', '2024-10-20 11:00:00+00'
FROM public.users WHERE username = 'alice_j';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at)
SELECT 'ORD-2024-0003', id, 'shipped', 189.97, 16.15, 0.00, 206.12, 'USD',
 '{"name": "Bob Smith", "street": "456 Oak Ave", "city": "Portland", "state": "OR", "zip": "97201", "country": "US"}',
 NULL, '{"payment_method": "paypal", "paypal_txn": "8BH29461MK"}',
 '2024-11-02 09:15:00+00', '2024-11-04 16:00:00+00', '2024-11-04 16:00:00+00'
FROM public.users WHERE username = 'bob_smith';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at, delivered_at)
SELECT 'ORD-2024-0004', id, 'delivered', 1349.97, 114.75, 0.00, 1464.72, 'USD',
 '{"name": "Carol Williams", "street": "789 Corp Blvd", "city": "Austin", "state": "TX", "zip": "78701", "country": "US"}',
 'Bulk order for team setup — Q4 budget',
 '{"payment_method": "invoice", "po_number": "PO-2024-1182", "net_days": 30}',
 '2024-11-10 11:00:00+00', '2024-11-16 14:30:00+00', '2024-11-12 10:00:00+00', '2024-11-16 14:30:00+00'
FROM public.users WHERE username = 'carol_w';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, cancelled_at)
SELECT 'ORD-2024-0005', id, 'cancelled', 79.99, 6.80, 9.99, 96.78, 'USD',
 '{"name": "Dave Kim", "street": "321 Pine St", "city": "Seattle", "state": "WA", "zip": "98101", "country": "US"}',
 NULL, '{"payment_method": "card_visa", "last4": "7890", "cancel_reason": "changed_mind", "refund_issued": true}',
 '2024-11-18 20:00:00+00', '2024-11-18 20:45:00+00', '2024-11-18 20:45:00'   -- cancelled_at is timestamp WITHOUT tz
FROM public.users WHERE username = 'dave_k';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at)
SELECT 'ORD-2024-0006', id, 'confirmed', 399.99, 34.00, 0.00, 433.99, 'USD',
 '{"name": "Eve Martinez", "street": "555 Startup Way", "city": "New York", "state": "NY", "zip": "10001", "country": "US"}',
 'Gift — please include gift receipt, no prices',
 '{"payment_method": "card_mastercard", "last4": "5555", "gift": true}',
 '2024-12-01 14:30:00+00', '2024-12-01 14:35:00+00'
FROM public.users WHERE username = 'eve_m';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at)
SELECT 'ORD-2024-0007', id, 'pending', 39.99, 3.40, 4.99, 48.38, 'USD',
 '{"name": "Grace Lee", "street": "88 Cherry Blossom Ln", "city": "Los Angeles", "state": "CA", "zip": "90001", "country": "US"}',
 NULL, '{"payment_method": "card_visa", "last4": "1111"}',
 '2024-12-14 22:10:00+00', '2024-12-14 22:10:00+00'
FROM public.users WHERE username = 'grace_l';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at, delivered_at)
SELECT 'ORD-2024-0008', id, 'delivered', 849.99, 72.25, 0.00, 922.24, 'USD',
 '{"name": "Henry Brown", "street": "1 Corporate Plaza", "city": "Chicago", "state": "IL", "zip": "60601", "country": "US"}',
 'Expedited — must arrive before end of quarter',
 '{"payment_method": "corporate_card", "last4": "9900", "expense_code": "IT-Q4-2024", "requires_receipt": true}',
 '2024-11-25 09:00:00+00', '2024-11-28 16:00:00+00', '2024-11-26 11:00:00+00', '2024-11-28 16:00:00+00'
FROM public.users WHERE username = 'henry_b';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at)
SELECT 'ORD-2024-0009', id, 'shipped', 179.99, 15.30, 9.99, 205.28, 'USD',
 '{"name": "Kelly Rodriguez", "street": "42 Design District", "city": "Miami", "state": "FL", "zip": "33132", "country": "US"}',
 NULL, '{"payment_method": "card_amex", "last4": "3726"}',
 '2024-12-10 11:30:00+00', '2024-12-12 09:00:00+00', '2024-12-12 09:00:00+00'
FROM public.users WHERE username = 'kelly_r';

INSERT INTO public.orders (reference, user_id, status, subtotal, tax, shipping, total, currency, shipping_addr, notes, metadata, created_at, updated_at, shipped_at, delivered_at)
SELECT 'ORD-2024-0010', id, 'delivered', 199.99, 0.00, 0.00, 199.99, 'USD',
 '{"name": "Maya Singh", "street": "77 University Ave", "city": "Cambridge", "state": "MA", "zip": "02139", "country": "US"}',
 NULL, '{"payment_method": "card_visa", "last4": "2020", "promo_code": "EDU20", "promo_discount": 40.00}',
 '2024-11-05 16:00:00+00', '2024-11-08 12:00:00+00', '2024-11-06 10:00:00+00', '2024-11-08 12:00:00+00'
FROM public.users WHERE username = 'maya_s';


-- ─── Order Items ──────────────────────────────────────────────
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, discount, subtotal, attributes) VALUES
-- ORD-0001: KB-001
(1, 1, 1, 149.99, 0.00, 149.99, '{"color": "space-grey"}'),
-- ORD-0002: MN-001
(2, 5, 1, 549.99, 0.00, 549.99, NULL),
-- ORD-0003: MS-001 + DC-001
(3, 3, 1, 59.99, 10.00, 49.99, NULL),
(3, 12, 1, 39.99,  0.00, 39.99, '{"color": "black"}'),
(3, 13, 1, 79.99,  0.00, 79.99, '{"color": "white"}'),
-- ORD-0004: MN-001 + KB-001 + CH-001
(4, 5, 1, 549.99, 0.00, 549.99, NULL),
(4, 1, 1, 149.99, 0.00, 149.99, NULL),
(4, 14, 1, 649.99, 0.00, 649.99, NULL),  -- CH-001 on sale price
-- ORD-0005: MS-002 (cancelled)
(5, 4, 1, 79.99, 0.00, 79.99, NULL),
-- ORD-0006: CH-001
(6, 14, 1, 399.99, 0.00, 399.99, '{"color": "black", "gift_wrap": true}'),
-- ORD-0007: DC-001
(7, 12, 1, 39.99, 0.00, 39.99, '{"color": "grey"}'),
-- ORD-0008: MN-002
(8, 6, 1, 849.99, 0.00, 849.99, NULL),
-- ORD-0009: HD-002
(9, 10, 1, 179.99, 0.00, 179.99, NULL),
-- ORD-0010: SW-001
(10, 16, 1, 199.99, 0.00, 199.99, '{"seats": 10, "license_key": "XXXX-YYYY-ZZZZ-0001"}');


-- ─── Inventory ────────────────────────────────────────────────
INSERT INTO inventory.warehouses (code, name, address, is_active) VALUES
('US-WEST', 'West Coast Fulfillment Center',
 '{"street": "100 Warehouse Blvd", "city": "Los Angeles", "state": "CA", "zip": "90001", "country": "US", "lat": 34.0522, "lng": -118.2437}',
 true),
('US-EAST', 'East Coast Fulfillment Center',
 '{"street": "200 Logistics Way", "city": "Newark", "state": "NJ", "zip": "07105", "country": "US", "lat": 40.7357, "lng": -74.1724}',
 true),
('EU-CENTRAL', 'European Hub',
 '{"street": "Industriestraße 55", "city": "Frankfurt", "state": "Hessen", "zip": "60327", "country": "DE", "lat": 50.1109, "lng": 8.6821}',
 true),
('RETURNS', 'Returns Processing Center',
 '{"street": "50 Returns Rd", "city": "Indianapolis", "state": "IN", "zip": "46201", "country": "US"}',
 false);

INSERT INTO inventory.stock_levels (warehouse_id, product_id, quantity, reserved, reorder_point) VALUES
(1,  1,  80,  5, 20), (2,  1,  63,  3, 20),
(1,  2,  50,  2, 15), (2,  2,  39,  1, 15),
(1,  3, 150,  8, 30), (2,  3, 117,  4, 30),
(1,  4,  30,  2, 10), (2,  4,  24,  1, 10),
(1,  5,  20,  3,  8), (2,  5,  12,  1,  8),
(1,  6,  10,  1,  5), (2,  6,   8,  0,  5),
(1,  7,  40,  2, 10), (2,  7,  36,  1, 10),
(1,  8, 120,  5, 25), (2,  8,  78,  3, 25),
(1,  9,  90,  4, 20), (2,  9,  66,  2, 20),
(1, 10,  25,  1,  8), (2, 10,  17,  0,  8),
(1, 11,  55,  2, 15), (2, 11,  36,  1, 15),
(1, 12, 200,  6, 40), (2, 12, 112,  3, 40),
(1, 13,  80,  3, 20), (2, 13,  48,  1, 20),
(1, 14,  15,  2,  5), (2, 14,   9,  0,  5),
(1, 15,   7,  1,  3), (2, 15,   4,  0,  3);

INSERT INTO inventory.movements (warehouse_id, product_id, movement_type, quantity, reference_id, notes, moved_at) VALUES
(1, 1, 'inbound',  200, NULL, 'Initial stock from supplier',          '2024-09-01 08:00:00+00'),
(2, 1, 'inbound',  150, NULL, 'Initial stock from supplier',          '2024-09-01 10:00:00+00'),
(1, 5, 'inbound',   50, NULL, 'Initial stock',                        '2024-09-01 08:30:00+00'),
(1, 1, 'outbound',   1, 1,   'Fulfil ORD-2024-0001',                  '2024-10-03 09:00:00+00'),
(1, 5, 'outbound',   1, 2,   'Fulfil ORD-2024-0002',                  '2024-10-17 08:30:00+00'),
(2, 3, 'outbound',   1, 3,   'Fulfil ORD-2024-0003',                  '2024-11-04 16:00:00+00'),
(1, 5, 'outbound',   1, 4,   'Fulfil ORD-2024-0004 (MN)',             '2024-11-12 10:00:00+00'),
(1, 1, 'outbound',   1, 4,   'Fulfil ORD-2024-0004 (KB)',             '2024-11-12 10:00:00+00'),
(1, 6, 'outbound',   1, 8,   'Fulfil ORD-2024-0008',                  '2024-11-26 11:00:00+00'),
(1, 4, 'inbound',    5, NULL, 'Restock from supplier',                '2024-12-01 09:00:00+00'),
(1, 5, 'transfer',  10, NULL, 'Transfer to EU warehouse',             '2024-12-05 14:00:00+00'),
(3, 5, 'inbound',   10, NULL, 'Transfer from US-WEST',                '2024-12-08 10:00:00+00'),
(4, 4, 'inbound',    1, 5,   'Return for ORD-2024-0005',              '2024-11-20 14:00:00+00'),
(4, 4, 'outbound',   1, NULL, 'Restock after return inspection',      '2024-11-22 09:00:00+00');


-- ─── Analytics: Sessions ──────────────────────────────────────
INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-15 09:20:00+00', '2024-12-15 11:35:15+00', 24, 'https://google.com', 'google', 'organic', NULL, 'desktop', 'Chrome 121', 'US', '{"resolution": "2560x1440", "os": "macOS 14"}'
FROM public.users WHERE username = 'alice_j';

INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-14 14:50:00+00', '2024-12-14 15:36:00+00', 7, NULL, NULL, NULL, NULL, 'desktop', 'Firefox 121', 'US', '{"resolution": "1920x1080", "os": "Windows 11"}'
FROM public.users WHERE username = 'bob_smith';

INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-15 11:00:00+00', '2024-12-15 19:15:30+00', 62, 'https://app.company.org', NULL, NULL, NULL, 'desktop', 'Chrome 121', 'FR', '{"resolution": "3840x2160", "os": "macOS 14", "timezone": "Europe/Paris"}'
FROM public.users WHERE username = 'carol_w';

INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-15 08:40:00+00', '2024-12-15 12:10:45+00', 31, 'https://twitter.com', 'twitter', 'social', 'devtools-launch', 'desktop', 'Arc 1.40', 'US', '{"resolution": "2560x1600", "os": "macOS 14"}'
FROM public.users WHERE username = 'eve_m';

INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-15 07:10:00+00', '2024-12-15 08:30:10+00', 12, NULL, NULL, NULL, NULL, 'mobile', 'Safari 17', 'TW', '{"device": "iPhone 15 Pro", "os": "iOS 17"}'
FROM public.users WHERE username = 'grace_l';

INSERT INTO analytics.sessions (user_id, started_at, ended_at, page_count, referrer, utm_source, utm_medium, utm_campaign, device_type, browser, country_code, metadata)
SELECT id, '2024-12-15 13:42:00+00', '2024-12-15 23:59:59+00', 88, 'https://bigcorp.com/intranet', 'internal', 'direct', NULL, 'desktop', 'Edge 121', 'US', '{"resolution": "1920x1200", "os": "Windows 11", "corporate_sso": true}'
FROM public.users WHERE username = 'henry_b';


-- ─── Analytics: Events ────────────────────────────────────────
INSERT INTO analytics.events (user_id, session_id, event_type, event_name, payload, properties, ip_address, user_agent, occurred_at, processed_at, is_processed)
SELECT
    u.id,
    s.id,
    'user',
    'page_view',
    '{"path": "/dashboard", "title": "Dashboard — Dendron"}',
    '{"referrer": "https://google.com", "load_time_ms": 342}',
    '203.0.113.42',
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/121.0',
    '2024-12-15 09:23:00+00',
    '2024-12-15 09:23:01',
    true
FROM public.users u
JOIN analytics.sessions s ON s.user_id = u.id
WHERE u.username = 'alice_j'
LIMIT 1;

INSERT INTO analytics.events (user_id, event_type, event_name, payload, ip_address, occurred_at, is_processed) VALUES
(
    (SELECT id FROM public.users WHERE username = 'alice_j'),
    'user', 'query_executed',
    '{"query_length": 124, "execution_ms": 45, "rows_returned": 1000, "connection": "prod-postgres", "truncated": true}',
    '203.0.113.42', '2024-12-15 09:30:00+00', true
),
(
    (SELECT id FROM public.users WHERE username = 'alice_j'),
    'user', 'export_csv',
    '{"rows": 1000, "columns": 8, "file_size_bytes": 45231}',
    '203.0.113.42', '2024-12-15 09:31:15+00', true
),
(
    (SELECT id FROM public.users WHERE username = 'bob_smith'),
    'user', 'connection_created',
    '{"connection_type": "postgres", "host_masked": "**.**.**.**"}',
    '198.51.100.77', '2024-12-14 14:52:00+00', true
),
(
    (SELECT id FROM public.users WHERE username = 'eve_m'),
    'user', 'query_executed',
    '{"query_length": 892, "execution_ms": 2341, "rows_returned": 50, "connection": "staging-db"}',
    '203.0.113.88', '2024-12-15 09:15:00+00', true
),
(
    (SELECT id FROM public.users WHERE username = 'eve_m'),
    'user', 'schema_viewed',
    '{"schema": "public", "table": "orders", "columns_count": 18}',
    '203.0.113.88', '2024-12-15 09:20:00+00', false
),
(
    NULL,
    'system', 'health_check',
    '{"service": "api", "status": "ok", "latency_ms": 12}',
    NULL, '2024-12-15 09:00:00+00', true
),
(
    NULL,
    'system', 'health_check',
    '{"service": "api", "status": "ok", "latency_ms": 9}',
    NULL, '2024-12-15 10:00:00+00', true
),
(
    (SELECT id FROM public.users WHERE username = 'henry_b'),
    'user', 'tab_opened',
    '{"tab_index": 3, "connection": "bigcorp-prod", "is_dangerous": true}',
    '192.0.2.200', '2024-12-15 13:44:00+00', false
);


-- ─── Analytics: Daily Metrics ─────────────────────────────────
INSERT INTO analytics.daily_metrics (metric_date, metric_name, metric_value, dimensions) VALUES
('2024-12-01', 'dau',            1243.0, '{}'),
('2024-12-01', 'queries_run',   18492.0, '{}'),
('2024-12-01', 'queries_run',    4201.0, '{"plan": "free"}'),
('2024-12-01', 'queries_run',    9847.0, '{"plan": "pro"}'),
('2024-12-01', 'queries_run',    4444.0, '{"plan": "enterprise"}'),
('2024-12-01', 'new_signups',      47.0, '{}'),
('2024-12-01', 'revenue_usd',   24891.5, '{}'),
('2024-12-07', 'dau',            1389.0, '{}'),
('2024-12-07', 'queries_run',   21044.0, '{}'),
('2024-12-07', 'new_signups',      53.0, '{}'),
('2024-12-07', 'revenue_usd',   31204.0, '{}'),
('2024-12-08', 'dau',             892.0, '{}'),   -- Sunday dip
('2024-12-08', 'queries_run',   11203.0, '{}'),
('2024-12-14', 'dau',            1521.0, '{}'),
('2024-12-14', 'queries_run',   24891.0, '{}'),
('2024-12-14', 'new_signups',      68.0, '{}'),
('2024-12-14', 'revenue_usd',   38441.25, '{}'),
('2024-12-15', 'dau',            1487.0, '{}'),
('2024-12-15', 'queries_run',   19203.0, '{}'),
('2024-12-15', 'p99_query_ms',    842.0, '{}'),
('2024-12-15', 'p99_query_ms',   1203.0, '{"plan": "free"}'),
('2024-12-15', 'p99_query_ms',    654.0, '{"plan": "pro"}'),
('2024-12-15', 'error_rate_pct',   0.12, '{}');


-- ─── Analytics: Feature Flags ─────────────────────────────────
INSERT INTO analytics.feature_flags (flag_key, description, is_enabled, rollout_pct, targeting_rules, variants, enabled_at) VALUES
('cell_detail_panel',  'Click-to-expand cell detail view',           true,  100.0, '[]', NULL, '2024-11-01 00:00:00+00'),
('sql_autocomplete',   'Context-aware SQL autocomplete',             true,  100.0, '[]', NULL, '2024-11-15 00:00:00+00'),
('row_editing',        'Inline row editing in result grid',          false,   0.0, '[]', NULL, NULL),
('dark_mode_v2',       'Redesigned dark mode with OLED optimizations', true, 50.0,
 '[{"operator": "in", "attribute": "plan", "values": ["pro", "enterprise"]}]',
 '{"control": "current_dark", "treatment": "oled_dark"}',
 '2024-12-01 00:00:00+00'),
('ssh_tunnels',        'SSH tunnel support for remote connections',  false,  5.0,
 '[{"operator": "eq", "attribute": "plan", "values": ["enterprise"]}]',
 NULL, NULL),
('ai_query_explain',   'AI-powered natural language query explanations', false, 2.0,
 '[{"operator": "in", "attribute": "tags", "values": ["beta-tester"]}]',
 NULL, NULL);


-- ─── Audit Log ────────────────────────────────────────────────
INSERT INTO public.audit_log (table_name, record_id, action, old_values, new_values, changed_by, ip_address) VALUES
('users', (SELECT id::text FROM public.users WHERE username = 'jack_p'),
 'UPDATE',
 '{"status": "active"}',
 '{"status": "suspended"}',
 (SELECT id FROM public.users WHERE username = 'alice_j'),
 '203.0.113.42'),
('users', (SELECT id::text FROM public.users WHERE username = 'iris_n'),
 'INSERT',
 NULL,
 '{"username": "iris_n", "email": "iris@example.com", "status": "pending"}',
 NULL,
 '198.51.100.3'),
('products', '5',
 'UPDATE',
 '{"price": 599.99, "sale_price": null}',
 '{"price": 599.99, "sale_price": 549.99}',
 (SELECT id FROM public.users WHERE username = 'alice_j'),
 '203.0.113.42'),
('orders', '5',
 'UPDATE',
 '{"status": "pending"}',
 '{"status": "cancelled", "cancelled_at": "2024-11-18T20:45:00"}',
 NULL,
 '10.0.0.55');
