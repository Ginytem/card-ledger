-- 卡账记 CardLedger D1 初始化脚本 v1.0
CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT NOT NULL,
  card_type TEXT DEFAULT '',
  last_4_digits TEXT NOT NULL,
  status TEXT DEFAULT 'normal',
  card_limit INTEGER DEFAULT 0,
  temp_limit INTEGER DEFAULT 0,
  temp_limit_expiry TEXT DEFAULT '',
  billing_day INTEGER NOT NULL,
  payment_type TEXT NOT NULL,
  payment_value INTEGER NOT NULL,
  grace_days INTEGER DEFAULT 0,
  max_grace_period INTEGER DEFAULT 0,
  annual_fee INTEGER DEFAULT 0,
  annual_fee_start TEXT DEFAULT '',
  annual_fee_end TEXT DEFAULT '',
  used_amount INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  paid_through TEXT DEFAULT ''   -- 已还到的还款日（列表快速标记本期已还）
);

CREATE TABLE IF NOT EXISTS limit_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  old_limit INTEGER NOT NULL,
  new_limit INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  bill_date TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  min_payment INTEGER DEFAULT 0,
  due_date TEXT DEFAULT '',
  paid INTEGER DEFAULT 0,
  paid_date TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  condition_type TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  cycle_start TEXT DEFAULT '',
  cycle_end TEXT DEFAULT '',
  annual_fee INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  sent_date TEXT NOT NULL,
  channel TEXT DEFAULT 'pushplus'
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('payment_advance_days', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('enable_pushplus', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('enable_email', '0');

INSERT INTO credit_cards (bank_name, card_type, last_4_digits, status, card_limit, temp_limit, temp_limit_expiry, billing_day, payment_type, payment_value, grace_days, max_grace_period, annual_fee, annual_fee_start, annual_fee_end, used_amount, notes)
VALUES
 ('示例银行A', '经典白', '1234', 'normal', 50000, 10000, '2026-12-31', 10, 'days_after_billing', 20, 3, 53, 0, '', '', 12000, '这是第一张示例卡'),
 ('示例银行B', 'YOUNG卡', '5678', 'normal', 100000, 0, '', 15, 'fixed_day', 5, 0, 35, 200, '2026-01-01', '2026-12-31', 30000, '年费刷6次免，当前4次');

INSERT INTO fee_rules (card_id, condition_type, target_value, current_value, cycle_start, cycle_end, annual_fee, status)
VALUES (2, 'times', 6, 4, '2026-01-01', '2026-12-31', 200, 'active');

INSERT INTO limit_changes (card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
VALUES (1, 40000, 50000, 'permanent', '2026-06-01', '银行提额', '2026-06-01 10:00:00');
