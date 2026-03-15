from odoo import api, fields, models, _


class ProjectTask(models.Model):
    _inherit = ["project.task"]

    annotation_ids = fields.One2many(
        "face.image.annotation",
        "task_id",
        string="Bild-Annotationen",
    )
    annotation_count = fields.Integer(
        string="Annotationen",
        compute="_compute_annotation_count",
    )

    @api.depends("annotation_ids")
    def _compute_annotation_count(self):
        for task in self:
            task.annotation_count = len(task.annotation_ids)

    def action_open_annotations(self):
        """Open list of annotations for this task."""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Bild-Annotationen"),
            "res_model": "face.image.annotation",
            "view_mode": "list,form",
            "domain": [("task_id", "=", self.id)],
            "context": {
                "default_task_id": self.id,
            },
        }

    def action_new_annotation(self):
        """Open annotator client action linked to this task."""
        self.ensure_one()
        return {
            "type": "ir.actions.client",
            "tag": "face_image_annotator",
            "name": _("Bild annotieren"),
            "params": {
                "task_id": self.id,
                "task_name": self.name,
            },
        }
