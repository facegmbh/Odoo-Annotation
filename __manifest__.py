{
    "name": "FACE Bild-Annotator",
    "version": "19.0.1.0.0",
    "category": "Productivity",
    "summary": "Bilder mit Text und Pfeilen annotieren — für Außendienst und Standalone",
    "description": """
        FACE Bild-Annotator
        ====================
        Ermöglicht das Annotieren von Bildern mit Text-Labels und Pfeilen.
        
        Features:
        - Standalone-App über eigenen Menüpunkt
        - Integration in Außendienst-Aufgaben (Field Service)
        - Touch-optimiert für iPad-Nutzung
        - Export als PNG
        - Annotierte Bilder werden als Anhänge gespeichert
    """,
    "author": "FACE Communication Equipment GmbH",
    "website": "https://www.face-gmbh.com",
    "license": "LGPL-3",
    "depends": [
        "base",
        "mail",
        "project",
        "industry_fsm",
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/image_annotation_views.xml",
        "views/project_task_views.xml",
        "views/menu.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "face_image_annotator/static/src/css/annotator.css",
            "face_image_annotator/static/src/js/annotator_action.js",
            "face_image_annotator/static/src/js/annotator_field_widget.js",
            "face_image_annotator/static/src/xml/annotator_templates.xml",
        ],
    },
    "installable": True,
    "application": True,
    "icon": "/face_image_annotator/static/description/icon.png",
}
