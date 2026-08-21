-- Customer shopping-interest preferences (JSON on users).
ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';
