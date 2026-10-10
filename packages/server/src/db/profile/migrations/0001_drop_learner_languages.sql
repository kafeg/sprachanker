-- The profile's own and learnt languages are gone; the pair filters they seeded are cleared (05).
DELETE FROM `settings` WHERE `key` IN ('learner.native', 'learner.target', 'catalog.pair', 'mine.pair');
