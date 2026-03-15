import base64
import json
from odoo import api, fields, models, _
from odoo.exceptions import UserError


class ImageAnnotation(models.Model):
    _name = "face.image.annotation"
    _description = "Bild-Annotation"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "create_date desc"

    name = fields.Char(
        string="Bezeichnung",
        required=True,
        default=lambda self: _("Neue Annotation"),
        tracking=True,
    )
    original_image = fields.Binary(
        string="Originalbild",
        attachment=True,
    )
    original_filename = fields.Char(string="Originaldateiname")
    annotated_image = fields.Binary(
        string="Annotiertes Bild",
        attachment=True,
    )
    annotated_filename = fields.Char(string="Annotierter Dateiname")
    annotations_json = fields.Text(
        string="Annotationsdaten (JSON)",
        help="Gespeicherte Annotation-Objekte als JSON für spätere Bearbeitung",
    )
    note = fields.Html(string="Notizen")

    # Relations
    task_id = fields.Many2one(
        "project.task",
        string="Außendienst-Aufgabe",
        ondelete="set null",
        index=True,
    )
    project_id = fields.Many2one(
        related="task_id.project_id",
        string="Projekt",
        store=True,
    )
    user_id = fields.Many2one(
        "res.users",
        string="Erstellt von",
        default=lambda self: self.env.user,
        tracking=True,
    )
    company_id = fields.Many2one(
        "res.company",
        string="Unternehmen",
        default=lambda self: self.env.company,
    )

    # Computed
    annotation_count = fields.Integer(
        string="Anzahl Anmerkungen",
        compute="_compute_annotation_count",
    )

    @api.depends("annotations_json")
    def _compute_annotation_count(self):
        for record in self:
            if record.annotations_json:
                try:
                    data = json.loads(record.annotations_json)
                    record.annotation_count = len(data) if isinstance(data, list) else 0
                except (json.JSONDecodeError, TypeError):
                    record.annotation_count = 0
            else:
                record.annotation_count = 0

    def action_open_annotator(self):
        """Open the annotation client action for this record."""
        self.ensure_one()
        return {
            "type": "ir.actions.client",
            "tag": "face_image_annotator",
            "name": _("Bild annotieren"),
            "params": {
                "annotation_id": self.id,
            },
        }

    def action_save_annotation(self, original_b64, annotated_b64, annotations_json, filename=""):
        """Called from JS to save annotation data."""
        self.ensure_one()
        vals = {
            "annotated_image": annotated_b64,
            "annotated_filename": filename or "annotiert.png",
            "annotations_json": annotations_json,
        }
        if original_b64 and not self.original_image:
            vals["original_image"] = original_b64
            vals["original_filename"] = filename or "original.png"
        self.write(vals)
        return True

    @api.model
    def create_from_annotator(self, vals):
        """Create a new annotation record from the client action."""
        record = self.create({
            "name": vals.get("name", _("Neue Annotation")),
            "original_image": vals.get("original_b64"),
            "original_filename": vals.get("filename", "original.png"),
            "annotated_image": vals.get("annotated_b64"),
            "annotated_filename": vals.get("filename", "annotiert.png"),
            "annotations_json": vals.get("annotations_json", "[]"),
            "task_id": vals.get("task_id"),
        })
        return record.id
