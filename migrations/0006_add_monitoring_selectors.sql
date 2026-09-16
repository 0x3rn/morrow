-- THE-21
-- Add page-level selector configuration for section monitoring
-- and user-configurable ignore regions.
--
-- An empty include array means:
--   monitor the whole page.
--
-- A non-empty include array means:
--   compare only content matching those CSS selectors.
--
-- Ignore selectors are removed from the comparison input
-- regardless of whether whole-page or section-level monitoring
-- is being used.
--
-- The raw rendered HTML, readable page snapshot and screenshot
-- remain unchanged and continue to be stored as full-page evidence.

ALTER TABLE monitored_pages
ADD COLUMN include_selectors_json TEXT NOT NULL DEFAULT '[]'
CHECK (
    CASE
        WHEN json_valid(include_selectors_json) = 1
        THEN json_type(include_selectors_json) = 'array'
        ELSE 0
    END
);

ALTER TABLE monitored_pages
ADD COLUMN ignore_selectors_json TEXT NOT NULL DEFAULT '[]'
CHECK (
    CASE
        WHEN json_valid(ignore_selectors_json) = 1
        THEN json_type(ignore_selectors_json) = 'array'
        ELSE 0
    END
);