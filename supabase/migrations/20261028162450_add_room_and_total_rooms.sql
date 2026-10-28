/*
# Add room column to lessons and total_rooms to institution_settings

1. Changes to existing tables:
   - `lessons`: adds `room` (text, nullable) — stores the classroom/room number for each lesson, extracted from imported timetable files.
   - `institution_settings`: adds `total_rooms` (integer, default 0) — the total number of rooms in the institution, used to calculate vacant rooms per time slot.

2. Security:
   - No new tables or policies. Existing RLS on `lessons` and `institution_settings` already controls access.
   - No new grants needed — existing grants cover the new columns.

3. Notes:
   - Both additions are additive (ALTER TABLE ADD COLUMN) — no data loss.
   - `room` is nullable so existing lessons are unaffected.
   - `total_rooms` defaults to 0 so institutions without this setting configured still work.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lessons' AND column_name = 'room') THEN
    ALTER TABLE lessons ADD COLUMN room text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'institution_settings' AND column_name = 'total_rooms') THEN
    ALTER TABLE institution_settings ADD COLUMN total_rooms integer NOT NULL DEFAULT 0;
  END IF;
END $$;
