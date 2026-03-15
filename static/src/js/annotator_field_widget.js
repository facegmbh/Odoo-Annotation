/** @odoo-module **/

import { registry } from "@web/core/registry";
import { ImageField, imageField } from "@web/views/fields/image/image_field";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

/**
 * Extends the standard Image field widget with an "Annotate" button.
 * Usage in XML: <field name="image_field" widget="image_annotatable"/>
 */
class ImageAnnotatableField extends ImageField {
    static template = "face_image_annotator.ImageAnnotatableField";

    setup() {
        super.setup();
        this.actionService = useService("action");
    }

    onAnnotateClick() {
        const resId = this.props.record?.resId;
        const resModel = this.props.record?.resModel;

        this.actionService.doAction({
            type: "ir.actions.client",
            tag: "face_image_annotator",
            name: _t("Bild annotieren"),
            params: {
                res_model: resModel,
                res_id: resId,
            },
        });
    }
}

const imageAnnotatableField = {
    ...imageField,
    component: ImageAnnotatableField,
    displayName: _t("Bild (annotierbar)"),
};

registry.category("fields").add("image_annotatable", imageAnnotatableField);
