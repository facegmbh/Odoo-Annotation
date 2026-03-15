/** @odoo-module **/

import { Component, useState, useRef, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

const TOOLS = { SELECT: "select", TEXT: "text", ARROW: "arrow" };
const COLORS = ["#E84C30", "#FFB800", "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#FFFFFF", "#000000"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ANNOTATIONS_JSON_VERSION = 1;
const UNDO_LIMIT = 50;

class FaceImageAnnotator extends Component {
    static template = "face_image_annotator.AnnotatorAction";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.svgRef = useRef("svgCanvas");
        this.imgRef = useRef("mainImage");
        this.containerRef = useRef("canvasContainer");
        this.fileInputRef = useRef("fileInput");

        const params = this.props.action?.params || {};
        this.annotationId = params.annotation_id || null;
        this.taskId = params.task_id || null;
        this.taskName = params.task_name || "";

        this.state = useState({
            image: null,
            annotations: [],
            _renderTick: 0,
            activeTool: TOOLS.SELECT,
            activeColor: "#E84C30",
            fontSize: 18,
            selectedId: null,
            editingId: null,
            editText: "",
            scale: 1,
            translateX: 0,
            translateY: 0,
            isDragOver: false,
            saving: false,
            annotationName: this.taskName
                ? `${this.taskName} - Annotation`
                : _t("Neue Annotation"),
            undoCount: 0,
            redoCount: 0,
        });

        this._undoStack = [];
        this._redoStack = [];
        this._autoSaveTimer = null;
        this._dragging = null;
        this._arrowStart = null;
        this._pinchStartDist = null;
        this._pinchStartScale = 1;
        this._isPanning = false;
        this._panStart = null;
        this._idCounter = 1;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onMiddleMouseMove = this._onMiddleMouseMove.bind(this);
        this._onMiddleMouseUp = this._onMiddleMouseUp.bind(this);

        onMounted(() => {
            document.addEventListener("keydown", this._onKeyDown);
            const container = this.containerRef.el;
            if (container) {
                container.addEventListener("wheel", this._onWheel, { passive: false });
            }
            if (this.annotationId) {
                this._loadAnnotation();
            } else {
                this._restoreDraft();
            }
        });

        onWillUnmount(() => {
            if (this._autoSaveTimer) {
                clearTimeout(this._autoSaveTimer);
                this._saveDraft(); // Sofort speichern, nicht auf Timer warten
            }
            document.removeEventListener("keydown", this._onKeyDown);
            const container = this.containerRef.el;
            if (container) {
                container.removeEventListener("wheel", this._onWheel);
            }
            document.removeEventListener("mousemove", this._onMiddleMouseMove);
            document.removeEventListener("mouseup", this._onMiddleMouseUp);
        });
    }

    // =========================================================================
    // GETTERS — all used in template, no JS expressions in t-att
    // =========================================================================

    get tools() { return TOOLS; }
    get colors() { return COLORS; }
    get hasImage() { return !!this.state.image; }
    get zoomPercentLabel() { return Math.round(this.state.scale * 100) + "%"; }
    get canUndo() { return this.state.undoCount > 0; }
    get canRedo() { return this.state.redoCount > 0; }

    get canvasTransformStyle() {
        const { translateX, translateY, scale } = this.state;
        return `transform: translate(${translateX}px, ${translateY}px) scale(${scale}); transform-origin: 0 0;`;
    }

    get svgCursorStyle() {
        const c = this.state.activeTool === TOOLS.SELECT ? "default" : "crosshair";
        return `cursor: ${c};`;
    }

    // Pre-computed scale-dependent values (no function calls in template)
    get hitWidth() { return 20 / this.state.scale; }
    get handleR() { return 8 / this.state.scale; }
    get handleStrokeW() { return 2 / this.state.scale; }
    get selStrokeW() { return 2 / this.state.scale; }

    get renderedArrows() {
        void this.state._renderTick;
        return this.state.annotations
            .filter(a => a.type === "arrow")
            .map(a => ({
                ...a,
                headPoints: this._arrowheadPoints(a),
            }));
    }

    get renderedTexts() {
        void this.state._renderTick;
        const pad = 6;
        return this.state.annotations
            .filter(a => a.type === "text")
            .map(a => {
                const charW = a.fontSize * 0.6;
                const bgW = a.text.length * charW + pad * 2;
                const bgH = a.fontSize + pad * 2;
                return {
                    ...a,
                    bgX: a.x - pad,
                    bgY: a.y - pad,
                    bgW,
                    bgH,
                    textY: a.y + a.fontSize * 0.82,
                    selX: a.x - pad - 2,
                    selY: a.y - pad - 2,
                    selW: bgW + 4,
                    selH: bgH + 4,
                    editW: Math.max(bgW, 160),
                    editH: bgH + 8,
                    editStyle: `color: ${a.color}; font-size: ${a.fontSize}px; border-color: ${a.color};`,
                };
            });
    }

    get arrowAnnotations() { return this.renderedArrows; }
    get textAnnotations() { return this.renderedTexts; }

    get statusText() {
        const t = this.state.activeTool;
        if (t === TOOLS.TEXT) return _t("Tippe/klicke um Text zu platzieren");
        if (t === TOOLS.ARROW) return _t("Ziehe um einen Pfeil zu zeichnen");
        if (this.state.selectedId) return _t("Entf = Löschen · Doppelklick = bearbeiten");
        return _t("2 Finger = Zoom · Ctrl+Scroll = Zoom");
    }

    get statusRight() {
        const c = this.state.annotations.length;
        const label = c !== 1 ? _t("Anmerkungen") : _t("Anmerkung");
        return `${c} ${label} · ${this.zoomPercentLabel}`;
    }

    // =========================================================================
    // HELPER: class strings for template
    // =========================================================================

    getToolBtnClass(tool) {
        const base = tool === "text" ? "face-tool-btn face-tool-text" : "face-tool-btn";
        return this.state.activeTool === tool ? base + " active" : base;
    }

    getColorBtnClass(c) {
        const classes = ["face-color-btn"];
        if (this.state.activeColor === c) classes.push("active");
        if (c === "#000000") classes.push("face-color-dark");
        return classes.join(" ");
    }

    getEditInputStyle(a) {
        return `color: ${a.color}; font-size: ${a.fontSize}px; border-color: ${a.color};`;
    }

    // =========================================================================
    // TOOL SELECTION — named methods, no lambdas
    // =========================================================================

    onSelectToolSelect() { this.state.activeTool = TOOLS.SELECT; this._arrowStart = null; }
    onSelectToolText() { this.state.activeTool = TOOLS.TEXT; this._arrowStart = null; }
    onSelectToolArrow() { this.state.activeTool = TOOLS.ARROW; this._arrowStart = null; }

    onColorBarClick(ev) {
        const btn = ev.target.closest("[data-color]");
        if (!btn) return;
        const color = btn.dataset.color;
        this.state.activeColor = color;
        if (this.state.selectedId) {
            this._pushUndoState();
            this._updateAnnotation(this.state.selectedId, { color });
            this._scheduleDraftSave();
        }
    }

    onFontSizeChange(ev) {
        const v = Number(ev.target.value);
        this.state.fontSize = v;
        if (this.state.selectedId) {
            this._updateAnnotation(this.state.selectedId, { fontSize: v });
            this._scheduleDraftSave();
        }
    }

    onNameInput(ev) {
        this.state.annotationName = ev.target.value;
        this._scheduleDraftSave();
    }

    // =========================================================================
    // UNDO / REDO
    // =========================================================================

    _pushUndoState() {
        this._undoStack.push(JSON.parse(JSON.stringify(this.state.annotations)));
        if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
        this._redoStack = [];
        this.state.undoCount = this._undoStack.length;
        this.state.redoCount = 0;
    }

    onUndo() {
        if (!this._undoStack.length) return;
        this._redoStack.push(JSON.parse(JSON.stringify(this.state.annotations)));
        this.state.annotations = this._undoStack.pop();
        this.state.undoCount = this._undoStack.length;
        this.state.redoCount = this._redoStack.length;
        this.state.selectedId = null;
        this.state.editingId = null;
        this._tickRender();
        this._scheduleDraftSave();
    }

    onRedo() {
        if (!this._redoStack.length) return;
        this._undoStack.push(JSON.parse(JSON.stringify(this.state.annotations)));
        this.state.annotations = this._redoStack.pop();
        this.state.undoCount = this._undoStack.length;
        this.state.redoCount = this._redoStack.length;
        this.state.selectedId = null;
        this.state.editingId = null;
        this._tickRender();
        this._scheduleDraftSave();
    }

    // =========================================================================
    // AUTO-SAVE / DRAFT
    // =========================================================================

    _getDraftKey() {
        return `face_annotator_draft_${this.annotationId || "new"}_${this.taskId || "none"}`;
    }

    _scheduleDraftSave() {
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => this._saveDraft(), 1500);
    }

    _saveDraft() {
        if (!this.state.image) return;
        try {
            localStorage.setItem(this._getDraftKey(), JSON.stringify({
                ts: Date.now(),
                annotationName: this.state.annotationName,
                image: this.state.image,
                annotations: this.state.annotations,
            }));
        } catch (e) { /* storage full – ignore */ }
    }

    _clearDraft() {
        try { localStorage.removeItem(this._getDraftKey()); } catch (e) { /* ignore */ }
    }

    _restoreDraft() {
        try {
            const raw = localStorage.getItem(this._getDraftKey());
            if (!raw) return;
            const draft = JSON.parse(raw);
            if (!draft.image) return;
            this.state.image = draft.image;
            this.state.annotations = draft.annotations || [];
            this.state.annotationName = draft.annotationName || this.state.annotationName;
            this._idCounter = (draft.annotations || []).reduce((max, a) => Math.max(max, a.id || 0), 0) + 1;
            this.notification.add(_t("Entwurf wiederhergestellt"), { type: "info" });
        } catch (e) { /* corrupt draft – ignore */ }
    }

    // =========================================================================
    // DATA LOADING
    // =========================================================================

    async _loadAnnotation() {
        try {
            const [record] = await this.orm.read(
                "face.image.annotation",
                [this.annotationId],
                ["original_image", "annotations_json", "name"]
            );
            if (record.original_image) {
                this.state.image = `data:image/png;base64,${record.original_image}`;
                this.state.annotationName = record.name;
                if (record.annotations_json) {
                    try {
                        const parsed = JSON.parse(record.annotations_json);
                        // Support both old format (plain array) and versioned format
                        const annotations = Array.isArray(parsed)
                            ? parsed
                            : (parsed.annotations || []);
                        this.state.annotations = annotations;
                        this._idCounter = annotations.reduce((max, a) => Math.max(max, a.id || 0), 0) + 1;
                    } catch (e) { /* ignore parse errors */ }
                }
            }
        } catch (e) {
            console.error("Failed to load annotation", e);
        }
    }

    // =========================================================================
    // FILE HANDLING
    // =========================================================================

    onFileInputChange(ev) {
        const file = ev.target.files[0];
        if (file) this._loadFile(file);
    }

    onDropZoneClick() { this.fileInputRef.el?.click(); }

    onDragOver(ev) { ev.preventDefault(); this.state.isDragOver = true; }
    onDragLeave() { this.state.isDragOver = false; }

    onDrop(ev) {
        ev.preventDefault();
        this.state.isDragOver = false;
        const file = ev.dataTransfer.files[0];
        if (file) this._loadFile(file);
    }

    _loadFile(file) {
        if (!file || !file.type.startsWith("image/")) return;
        if (file.size > MAX_FILE_SIZE) {
            this.notification.add(_t("Datei zu groß (max. 20 MB)"), { type: "warning" });
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            this.state.image = e.target.result;
            this.state.annotations = [];
            this.state.selectedId = null;
            this.state.scale = 1;
            this.state.translateX = 0;
            this.state.translateY = 0;
            this._undoStack = [];
            this._redoStack = [];
            this.state.undoCount = 0;
            this.state.redoCount = 0;
            this._scheduleDraftSave();
        };
        reader.readAsDataURL(file);
    }

    onNewImage() {
        this._clearDraft();
        this.state.image = null;
        this.state.annotations = [];
        this.state.selectedId = null;
        this.annotationId = null;
        this._undoStack = [];
        this._redoStack = [];
        this.state.undoCount = 0;
        this.state.redoCount = 0;
    }

    // =========================================================================
    // ANNOTATION ARRAY HELPERS — always replace array for reactivity
    // =========================================================================

    _addAnnotation(ann) {
        this.state.annotations = [...this.state.annotations, ann];
        this._scheduleDraftSave();
    }

    _removeAnnotation(id) {
        this.state.annotations = this.state.annotations.filter(a => a.id !== id);
        this._scheduleDraftSave();
    }

    _updateAnnotation(id, updates) {
        this.state.annotations = this.state.annotations.map(a =>
            a.id === id ? { ...a, ...updates } : a
        );
    }

    _tickRender() {
        this.state._renderTick++;
    }

    _findAnnotation(id) {
        return this.state.annotations.find(a => a.id === id);
    }

    // =========================================================================
    // SVG COORDINATE CONVERSION
    // =========================================================================

    _getSVGPoint(clientX, clientY) {
        const svg = this.svgRef.el;
        if (!svg) return { x: 0, y: 0 };
        const rect = svg.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / this.state.scale,
            y: (clientY - rect.top) / this.state.scale,
        };
    }

    _clientFromEvent(ev) {
        if (ev.touches && ev.touches.length > 0) {
            return { clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY };
        }
        if (ev.changedTouches && ev.changedTouches.length > 0) {
            return { clientX: ev.changedTouches[0].clientX, clientY: ev.changedTouches[0].clientY };
        }
        return { clientX: ev.clientX, clientY: ev.clientY };
    }

    // =========================================================================
    // CANVAS POINTER EVENTS
    // =========================================================================

    onCanvasMouseDown(ev) {
        if (ev.target.closest(".annotation-handle")) return;
        const pt = this._getSVGPoint(ev.clientX, ev.clientY);
        this._handlePointerDown(pt);
    }

    onCanvasTouchStart(ev) {
        if (ev.touches.length !== 1) return;
        if (ev.target.closest(".annotation-handle")) return;
        const pt = this._getSVGPoint(ev.touches[0].clientX, ev.touches[0].clientY);
        this._handlePointerDown(pt);
    }

    _handlePointerDown(pt) {
        if (this.state.activeTool === TOOLS.TEXT) {
            this._pushUndoState();
            const id = this._idCounter++;
            this._addAnnotation({
                id, type: "text", x: pt.x, y: pt.y,
                text: "Text hier", color: this.state.activeColor,
                fontSize: this.state.fontSize,
            });
            this.state.selectedId = id;
            this.state.editingId = id;
            this.state.editText = "Text hier";
            this.state.activeTool = TOOLS.SELECT;
        } else if (this.state.activeTool === TOOLS.ARROW) {
            this._arrowStart = pt;
        } else {
            this.state.selectedId = null;
            this.state.editingId = null;
        }
    }

    onCanvasMouseMove(ev) { this._handlePointerMove(ev); }
    onCanvasTouchMove(ev) {
        if (ev.touches.length !== 1) return;
        this._handlePointerMove(ev);
    }

    _handlePointerMove(ev) {
        const { clientX, clientY } = this._clientFromEvent(ev);
        const pt = this._getSVGPoint(clientX, clientY);
        const d = this._dragging;

        if (d) {
            ev.preventDefault();
            const ann = this._findAnnotation(d.id);
            if (!ann) return;

            if (ann.type === "text") {
                this._updateAnnotation(d.id, { x: pt.x - d.offX, y: pt.y - d.offY });
            } else if (ann.type === "arrow") {
                if (d.handle === "start") {
                    this._updateAnnotation(d.id, { x1: pt.x, y1: pt.y });
                } else if (d.handle === "end") {
                    this._updateAnnotation(d.id, { x2: pt.x, y2: pt.y });
                } else if (d.handle === "body") {
                    const dx = pt.x - d.lastX;
                    const dy = pt.y - d.lastY;
                    d.lastX = pt.x;
                    d.lastY = pt.y;
                    this._updateAnnotation(d.id, {
                        x1: ann.x1 + dx, y1: ann.y1 + dy,
                        x2: ann.x2 + dx, y2: ann.y2 + dy,
                    });
                }
            }
            d.hasMoved = true;
        }
    }

    onCanvasMouseUp(ev) { this._handlePointerUp(ev); }
    onCanvasTouchEnd(ev) { this._handlePointerUp(ev); }

    _handlePointerUp(ev) {
        if (this._arrowStart && this.state.activeTool === TOOLS.ARROW) {
            const { clientX, clientY } = this._clientFromEvent(ev);
            const pt = this._getSVGPoint(clientX, clientY);
            const dist = Math.hypot(pt.x - this._arrowStart.x, pt.y - this._arrowStart.y);
            if (dist > 15) {
                this._pushUndoState();
                const id = this._idCounter++;
                this._addAnnotation({
                    id, type: "arrow",
                    x1: this._arrowStart.x, y1: this._arrowStart.y,
                    x2: pt.x, y2: pt.y,
                    color: this.state.activeColor, strokeWidth: 3,
                });
                this.state.selectedId = id;
            }
            this._arrowStart = null;
        }
        if (this._dragging && this._dragging.hasMoved) {
            this._scheduleDraftSave();
        }
        this._dragging = null;
    }

    // =========================================================================
    // ANNOTATION DRAG — data-attribute based delegation
    // =========================================================================

    onAnnotationDragStart(ev) {
        const el = ev.target.closest("[data-ann-id]");
        if (!el) return;
        ev.stopPropagation();

        const annId = Number(el.dataset.annId);
        const handle = el.dataset.handle || "body";
        const ann = this._findAnnotation(annId);
        if (!ann) return;

        const { clientX, clientY } = this._clientFromEvent(ev);
        const pt = this._getSVGPoint(clientX, clientY);

        this._pushUndoState();

        if (ann.type === "text") {
            this._dragging = { id: annId, handle: "body", offX: pt.x - ann.x, offY: pt.y - ann.y, hasMoved: false };
        } else {
            this._dragging = { id: annId, handle, offX: 0, offY: 0, lastX: pt.x, lastY: pt.y, hasMoved: false };
        }

        this.state.selectedId = annId;
        if (this.state.activeTool !== TOOLS.SELECT) {
            this.state.activeTool = TOOLS.SELECT;
        }
    }

    onAnnotationDblClick(ev) {
        const el = ev.target.closest("[data-ann-id]");
        if (!el) return;
        ev.stopPropagation();
        const annId = Number(el.dataset.annId);
        const ann = this._findAnnotation(annId);
        if (ann && ann.type === "text") {
            this.state.editingId = annId;
            this.state.editText = ann.text;
        }
    }

    // =========================================================================
    // TEXT EDITING
    // =========================================================================

    onEditInput(ev) { this.state.editText = ev.target.value; }
    onEditBlur() { this._commitEdit(); }
    onEditKeyDown(ev) {
        if (ev.key === "Enter") this._commitEdit();
        if (ev.key === "Escape") this.state.editingId = null;
        ev.stopPropagation();
    }

    _commitEdit() {
        if (this.state.editingId && this.state.editText.trim()) {
            this._pushUndoState();
            this._updateAnnotation(this.state.editingId, { text: this.state.editText });
            this._scheduleDraftSave();
        }
        this.state.editingId = null;
    }

    deleteSelected() {
        if (this.state.selectedId) {
            this._pushUndoState();
            this._removeAnnotation(this.state.selectedId);
            this.state.selectedId = null;
            this.state.editingId = null;
        }
    }

    // =========================================================================
    // ZOOM & PAN
    // =========================================================================

    zoomIn() { this.state.scale = Math.min(5, this.state.scale * 1.3); }
    zoomOut() { this.state.scale = Math.max(0.25, this.state.scale / 1.3); }
    resetZoom() { this.state.scale = 1; this.state.translateX = 0; this.state.translateY = 0; }

    _onWheel(ev) {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const delta = -ev.deltaY * 0.005;
        this.state.scale = Math.min(5, Math.max(0.25, this.state.scale * (1 + delta)));
    }

    onContainerMouseDown(ev) {
        if (ev.button === 1) {
            ev.preventDefault();
            this._isPanning = true;
            this._panStart = { x: ev.clientX - this.state.translateX, y: ev.clientY - this.state.translateY };
            document.addEventListener("mousemove", this._onMiddleMouseMove);
            document.addEventListener("mouseup", this._onMiddleMouseUp);
        }
    }

    _onMiddleMouseMove(ev) {
        if (this._isPanning && this._panStart) {
            this.state.translateX = ev.clientX - this._panStart.x;
            this.state.translateY = ev.clientY - this._panStart.y;
        }
    }

    _onMiddleMouseUp() {
        this._isPanning = false;
        this._panStart = null;
        document.removeEventListener("mousemove", this._onMiddleMouseMove);
        document.removeEventListener("mouseup", this._onMiddleMouseUp);
    }

    onContainerTouchStart(ev) {
        if (ev.touches.length === 2) {
            ev.preventDefault();
            this._pinchStartDist = Math.hypot(
                ev.touches[0].clientX - ev.touches[1].clientX,
                ev.touches[0].clientY - ev.touches[1].clientY
            );
            this._pinchStartScale = this.state.scale;
        }
    }

    onContainerTouchMove(ev) {
        if (ev.touches.length === 2 && this._pinchStartDist) {
            ev.preventDefault();
            const dist = Math.hypot(
                ev.touches[0].clientX - ev.touches[1].clientX,
                ev.touches[0].clientY - ev.touches[1].clientY
            );
            this.state.scale = Math.min(5, Math.max(0.25,
                this._pinchStartScale * (dist / this._pinchStartDist)
            ));
        }
    }

    onContainerTouchEnd(ev) {
        if (ev.touches.length < 2) this._pinchStartDist = null;
    }

    // =========================================================================
    // KEYBOARD
    // =========================================================================

    _onKeyDown(ev) {
        if ((ev.key === "Delete" || ev.key === "Backspace") && !this.state.editingId) {
            this.deleteSelected();
        }
        if (ev.key === "Escape") {
            this.state.selectedId = null;
            this.state.editingId = null;
            this._arrowStart = null;
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key === "z" && !ev.shiftKey) {
            ev.preventDefault();
            this.onUndo();
        }
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "y" || (ev.key === "z" && ev.shiftKey))) {
            ev.preventDefault();
            this.onRedo();
        }
    }

    // =========================================================================
    // GEOMETRY HELPERS
    // =========================================================================

    _arrowheadPoints(a) {
        const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const hl = 14;
        const p1x = a.x2 - hl * Math.cos(angle - Math.PI / 6);
        const p1y = a.y2 - hl * Math.sin(angle - Math.PI / 6);
        const p2x = a.x2 - hl * Math.cos(angle + Math.PI / 6);
        const p2y = a.y2 - hl * Math.sin(angle + Math.PI / 6);
        return `${a.x2},${a.y2} ${p1x},${p1y} ${p2x},${p2y}`;
    }

    // =========================================================================
    // EXPORT & SAVE
    // =========================================================================

    _drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    _renderToCanvas() {
        return new Promise((resolve, reject) => {
            const el = this.imgRef.el;
            if (!el || !this.state.image) return reject("No image");
            const baseW = el.clientWidth;
            const baseH = el.clientHeight;
            if (!baseW || !baseH) return reject("No dimensions");

            const canvas = document.createElement("canvas");
            const s = 2;
            canvas.width = baseW * s;
            canvas.height = baseH * s;
            const ctx = canvas.getContext("2d");
            ctx.scale(s, s);

            const img = new Image();
            img.onload = () => {
                try {
                    ctx.drawImage(img, 0, 0, baseW, baseH);

                    // Draw annotations
                    for (const a of this.state.annotations) {
                        if (a.type === "text") {
                            ctx.font = `bold ${a.fontSize}px "Segoe UI", sans-serif`;
                            ctx.textBaseline = "top";
                            const m = ctx.measureText(a.text);
                            ctx.fillStyle = "rgba(0,0,0,0.65)";
                            this._drawRoundedRect(ctx, a.x - 6, a.y - 6, m.width + 12, a.fontSize + 12, 4);
                            ctx.fill();
                            ctx.fillStyle = a.color;
                            ctx.fillText(a.text, a.x, a.y);
                        }
                        if (a.type === "arrow") {
                            const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
                            const hl = 14;
                            ctx.strokeStyle = a.color;
                            ctx.lineWidth = a.strokeWidth;
                            ctx.lineCap = "round";
                            ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke();
                            ctx.fillStyle = a.color;
                            ctx.beginPath();
                            ctx.moveTo(a.x2, a.y2);
                            ctx.lineTo(a.x2 - hl * Math.cos(angle - Math.PI / 6), a.y2 - hl * Math.sin(angle - Math.PI / 6));
                            ctx.lineTo(a.x2 - hl * Math.cos(angle + Math.PI / 6), a.y2 - hl * Math.sin(angle + Math.PI / 6));
                            ctx.closePath();
                            ctx.fill();
                        }
                    }

                    // ── FACE watermark (bottom-left) ──────────────────────────
                    const wmFontSize = Math.max(14, Math.min(Math.round(baseW / 18), 36));
                    ctx.font = `bold ${wmFontSize}px "Segoe UI", sans-serif`;
                    ctx.textBaseline = "bottom";
                    ctx.globalAlpha = 0.45;
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillText("FACE", 12, baseH - 8);
                    ctx.globalAlpha = 1.0;

                    // ── Date/time stamp (bottom-right) ────────────────────────
                    const now = new Date();
                    const dateStr = now.toLocaleDateString("de-DE", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                    }) + "  " + now.toLocaleTimeString("de-DE", {
                        hour: "2-digit", minute: "2-digit",
                    });
                    const stampFontSize = Math.max(11, Math.min(Math.round(baseW / 40), 16));
                    ctx.font = `${stampFontSize}px "Segoe UI", sans-serif`;
                    ctx.textBaseline = "bottom";
                    const tm = ctx.measureText(dateStr);
                    const padH = 6, padV = 4;
                    const bw = tm.width + padH * 2;
                    const bh = stampFontSize + padV * 2;
                    const bx = baseW - bw - 8;
                    const by = baseH - bh - 8;
                    ctx.globalAlpha = 0.55;
                    ctx.fillStyle = "#000000";
                    this._drawRoundedRect(ctx, bx, by, bw, bh, 3);
                    ctx.fill();
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillText(dateStr, bx + padH, by + bh - padV);
                    ctx.globalAlpha = 1.0;

                    resolve(canvas.toDataURL("image/png"));
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject("Image load failed");
            img.src = this.state.image;
        });
    }

    _dataUrlToBase64(dataUrl) {
        return dataUrl.replace(/^data:image\/\w+;base64,/, "");
    }

    async onSave() {
        if (!this.state.image || this.state.saving) return;
        this.state.saving = true;

        try {
            const dataUrl = await this._renderToCanvas();
            const annotatedB64 = this._dataUrlToBase64(dataUrl);
            const originalB64 = this._dataUrlToBase64(this.state.image);
            const annotationsJson = JSON.stringify({
                version: ANNOTATIONS_JSON_VERSION,
                annotations: this.state.annotations,
            });

            if (this.annotationId) {
                await this.orm.call(
                    "face.image.annotation",
                    "action_save_annotation",
                    [[this.annotationId], originalB64, annotatedB64, annotationsJson, "annotiert.png"]
                );
            } else {
                this.annotationId = await this.orm.call(
                    "face.image.annotation",
                    "create_from_annotator",
                    [{
                        name: this.state.annotationName,
                        original_b64: originalB64,
                        annotated_b64: annotatedB64,
                        annotations_json: annotationsJson,
                        filename: "annotiert.png",
                        task_id: this.taskId || false,
                    }]
                );
            }

            this._clearDraft();
            this.notification.add(_t("Annotation gespeichert"), { type: "success" });
        } catch (e) {
            console.error("Save failed:", e);
            this.notification.add(_t("Fehler beim Speichern"), { type: "danger" });
        } finally {
            this.state.saving = false;
        }
    }

    onGoBack() {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "face.image.annotation",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
        });
    }
}

registry.category("actions").add("face_image_annotator", FaceImageAnnotator);
