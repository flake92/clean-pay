CREATE TABLE ad_links (
  id integer PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE users (
  id integer PRIMARY KEY,
  ad_link_id integer REFERENCES ad_links(id),
  is_trial_available boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE transactions (
  id integer PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL,
  is_test boolean NOT NULL,
  pricing jsonb NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO ad_links VALUES
  (1, 'Lopez', 'lopez', true, '2026-07-01T00:00:00Z'),
  (2, 'Other', 'ad_other', true, '2026-07-01T00:00:00Z');

INSERT INTO users VALUES
  (101, 1, false, '2026-08-01T09:00:00+03:00'),
  (102, 1, true,  '2026-08-02T09:00:00+03:00'),
  (103, 1, false, '2026-07-20T09:00:00+03:00'),
  (104, 1, false, '2026-07-01T09:00:00+03:00'),
  (105, 2, false, '2026-08-01T09:00:00+03:00');

INSERT INTO transactions VALUES
  (1, 101, 'COMPLETED', false, '{"final_amount":"100"}', 'RUB', '2026-08-03T10:00:00+03:00'),
  (2, 101, 'COMPLETED', false, '{"final_amount":"50"}',  'RUB', '2026-08-10T10:00:00+03:00'),
  (3, 102, 'COMPLETED', false, '{"final_amount":"200"}', 'USD', '2026-08-06T10:00:00+03:00'),
  (4, 103, 'COMPLETED', false, '{"final_amount":"300"}', 'RUB', '2026-08-02T10:00:00+03:00'),
  (5, 104, 'COMPLETED', false, '{"final_amount":"400"}', 'RUB', '2026-08-02T10:00:00+03:00'),
  (6, 101, 'FAILED',    false, '{"final_amount":"900"}', 'RUB', '2026-08-04T10:00:00+03:00'),
  (7, 101, 'COMPLETED', true,  '{"final_amount":"800"}', 'RUB', '2026-08-05T10:00:00+03:00'),
  (8, 101, 'COMPLETED', false, '{"final_amount":"0"}',   'RUB', '2026-08-06T10:00:00+03:00'),
  (9, 105, 'COMPLETED', false, '{"final_amount":"700"}', 'RUB', '2026-08-07T10:00:00+03:00');
