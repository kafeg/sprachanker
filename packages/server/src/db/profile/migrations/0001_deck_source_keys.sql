-- A card of an imported deck's word: its source key names the deck too (deck:<id>/<note guid>), so two
-- decks sharing a note never share a card's source.
UPDATE `cards`
SET `source_key` = 'deck:' || json_extract(`display_cache_json`, '$.deck') || '/' || `source_key`
WHERE `source_key` IS NOT NULL
  AND `source_key` NOT LIKE 'deck:%'
  AND CASE WHEN json_valid(`display_cache_json`) THEN json_extract(`display_cache_json`, '$.deck') END IS NOT NULL;
