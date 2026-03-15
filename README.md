# FACE Bild-Annotator

Odoo 19.0 Modul zur Bild-Annotation für den Außendienst (FSM). Techniker können Fotos direkt in Odoo mit Texten und Pfeilen beschriften – optimiert für iPad und iPhone.

---

## Features

- **Text & Pfeile** – Annotierungen per Tippen/Ziehen platzieren
- **Undo/Redo** – Bis zu 50 Schritte rückgängig (Strg+Z / Strg+Y oder Toolbar-Buttons)
- **Auto-Save / Draft** – Änderungen werden automatisch lokal gespeichert und beim nächsten Öffnen wiederhergestellt
- **Farbpalette** – 8 Farben (Orange, Gelb, Grün, Blau, Lila, Pink, Weiß, Schwarz)
- **Schriftgröße** – Stufenlos von 12–48 px einstellbar
- **Zoom & Pan** – Pinch-Zoom (Touch), Mausrad (Ctrl+Scroll), Mitteltaste zum Verschieben
- **FACE Wasserzeichen** – Wird automatisch unten links ins exportierte Bild eingebettet
- **Datum/Uhrzeit-Stempel** – Wird automatisch unten rechts ins exportierte Bild eingebettet
- **FSM-Integration** – Smart-Button und Annotator-Button direkt in Außendienst-Aufgaben
- **Datei-Größenlimit** – Upload-Limit 20 MB mit Benutzerhinweis

---

## Screenshots

| Annotator | FSM-Aufgabe |
|---|---|
| Toolbar mit Werkzeugen, Farben, Undo/Redo | Smart-Button mit Anzahl der Annotationen |

---

## Installation

### Voraussetzungen

- Odoo 19.0
- Module: `base`, `mail`, `project`, `industry_fsm`

### Schritte

1. Modul-Ordner `face_image_annotator` in das Odoo-Addons-Verzeichnis kopieren
2. Odoo-Server neu starten
3. In Odoo: **Einstellungen → Apps → Aktualisieren** und nach `FACE Bild-Annotator` suchen
4. Installieren

---

## Verwendung

### Standalone (Menü)

**Bild-Annotator → Neues Bild annotieren**

1. Bild per Drag & Drop oder Klick hochladen
2. Werkzeug wählen (↖ Auswahl / T Text / → Pfeil)
3. Farbe und Schriftgröße einstellen
4. Annotationen platzieren, verschieben, bearbeiten (Doppelklick)
5. **💾 Speichern** – exportiert das Bild mit FACE-Wasserzeichen und Zeitstempel

### FSM-Integration

In einer Außendienst-Aufgabe:

- **„Bild annotieren"**-Button in der Kopfzeile → öffnet neuen Annotator mit Aufgaben-Kontext
- **📷-Smart-Button** (oben rechts) → zeigt alle Annotationen zur Aufgabe

---

## Berechtigungen

| Gruppe | Lesen | Schreiben | Erstellen | Löschen |
|---|:---:|:---:|:---:|:---:|
| Alle Benutzer | ✓ | ✓ | ✓ | ✗ |
| Projekt-Manager | ✓ | ✓ | ✓ | ✓ |

---

## Technischer Aufbau

```
face_image_annotator/
├── models/
│   ├── image_annotation.py   # Haupt-Modell (face.image.annotation)
│   └── project_task.py       # Erweiterung project.task
├── security/
│   └── ir.model.access.csv
├── static/src/
│   ├── css/annotator.css     # Dark-Mode UI
│   ├── js/
│   │   ├── annotator_action.js        # OWL-Hauptkomponente (~430 Zeilen)
│   │   └── annotator_field_widget.js  # Bild-Feld-Widget
│   └── xml/annotator_templates.xml   # OWL-Templates
└── views/
    ├── image_annotation_views.xml
    ├── project_task_views.xml
    └── menu.xml
```

**Stack:** Python (Odoo ORM) · JavaScript (OWL) · SVG · CSS

---

## Lizenz

LGPL-3.0 · © FACE Communication Equipment GmbH
