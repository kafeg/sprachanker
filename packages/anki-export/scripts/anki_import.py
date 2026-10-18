"""An .apkg imported by Anki's own library into an empty collection: what Anki made of it, as JSON.

Usage: python -I anki_import.py <package.apkg> <empty folder>   (pip install anki==26.5)
Prints the decks, note types, notes (guid, fields, tags), cards (deck, template, type, queue) and the
media files Anki keeps (name, size), the note fields' sounds checked against them.
"""

import json
import os
import re
import sys

from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest

package, folder = sys.argv[1], sys.argv[2]
os.makedirs(folder, exist_ok=True)
col = Collection(os.path.join(folder, "collection.anki2"))
try:
    col.import_anki_package(
        ImportAnkiPackageRequest(package_path=os.path.abspath(package), options=ImportAnkiPackageOptions())
    )
    media_dir = col.media.dir()
    media = {name: os.path.getsize(os.path.join(media_dir, name)) for name in os.listdir(media_dir)}
    notes = []
    for nid in col.find_notes(""):
        note = col.get_note(nid)
        notes.append(
            {
                "guid": note.guid,
                "type": note.note_type()["name"],
                "fields": dict(note.items()),
                "tags": note.tags,
            }
        )
    cards = []
    for cid in col.find_cards(""):
        card = col.get_card(cid)
        cards.append(
            {
                "deck": col.decks.name(card.did),
                "ord": card.ord,
                "type": card.type,
                "queue": card.queue,
                "question": card.question(),
            }
        )
    sounds = sorted({s for n in notes for v in n["fields"].values() for s in re.findall(r"\[sound:([^\]]+)\]", v)})
    print(
        json.dumps(
            {
                "decks": sorted(d.name for d in col.decks.all_names_and_ids()),
                "noteTypes": sorted(m.name for m in col.models.all_names_and_ids()),
                "notes": notes,
                "cards": cards,
                "media": media,
                "missingSounds": [s for s in sounds if s not in media],
            },
            ensure_ascii=False,
        )
    )
finally:
    col.close()
