import { Color } from '../core/color.js';

import { Mat4 } from '../math/mat4.js';
import { Vec3 } from '../math/vec3.js';

import {
    BUFFER_DYNAMIC,
    PRIMITIVE_LINES, PRIMITIVE_TRISTRIP,
    SEMANTIC_POSITION, SEMANTIC_COLOR,
    TYPE_FLOAT32, TYPE_UINT8
} from '../graphics/graphics.js';
import { VertexBuffer } from '../graphics/vertex-buffer.js';
import { VertexFormat } from '../graphics/vertex-format.js';
import { VertexIterator } from '../graphics/vertex-iterator.js';

import {
    BLEND_NORMAL,
    LAYERID_IMMEDIATE,
    LINEBATCH_OVERLAY
} from '../scene/constants.js';
import { BasicMaterial } from '../scene/materials/basic-material.js';
import { GraphNode } from '../scene/graph-node.js';
import { Mesh } from '../scene/mesh.js';
import { MeshInstance } from '../scene/mesh-instance.js';

import { Application } from '../framework/application.js';

var tempGraphNode = new GraphNode();
var identityGraphNode = new GraphNode();
var meshInstanceArray = [];

var _deprecationWarning = false;

function ImmediateData(device) {
    this.lineVertexFormat = new VertexFormat(device, [
        { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
        { semantic: SEMANTIC_COLOR, components: 4, type: TYPE_UINT8, normalize: true }
    ]);
    this.lineBatches = [];
    this.layers = [];
    this.layerToBatch = {};
    this.quadMesh = null;
    this.cubeLocalPos = null;
    this.cubeWorldPos = null;
    this.identityGraphNode = new GraphNode();
}

ImmediateData.prototype.addLayer = function (layer) {
    if (this.layers.indexOf(layer) < 0) {
        this.layers.push(layer);
    }
};

ImmediateData.prototype.getLayerIdx = function (layer) {
    return this.layerToBatch[layer.id];
};

ImmediateData.prototype.addLayerIdx = function (idx, layer) {
    this.layerToBatch[layer.id] = idx;
};

function LineBatch() {
    // Sensible default value; buffers will be doubled and reallocated when it's not enough
    this.numLinesAllocated = 128;

    this.vb = null;
    this.vbRam = null;
    this.mesh = null;
    this.linesUsed = 0;
    this.material = null;
    this.meshInstance = null;

    this.layer = null;
}

Object.assign(LineBatch.prototype, {
    init: function (device, vertexFormat, layer, linesToAdd) {
        // Allocate basic stuff once per batch
        if (!this.mesh) {
            this.mesh = new Mesh(device);
            this.mesh.primitive[0].type = PRIMITIVE_LINES;
            this.mesh.primitive[0].base = 0;
            this.mesh.primitive[0].indexed = false;

            this.material = new BasicMaterial();
            this.material.vertexColors = true;
            this.material.blend = true;
            this.material.blendType = BLEND_NORMAL;
            this.material.update();
        }

        this.layer = layer;

        // Increase buffer size, if it's not enough
        while ((this.linesUsed + linesToAdd) > this.numLinesAllocated) {
            if (this.vb) {
                this.vb.destroy();
                this.vb = null;
            }
            this.numLinesAllocated *= 2;
        }

        this.vertexFormat = vertexFormat;

        // (Re)allocate line buffer
        if (!this.vb) {
            this.vb = new VertexBuffer(device, vertexFormat, this.numLinesAllocated * 2, BUFFER_DYNAMIC);
            this.mesh.vertexBuffer = this.vb;
            this.vbRam = new DataView(this.vb.lock());

            if (!this.meshInstance) {
                identityGraphNode.worldTransform = Mat4.IDENTITY;
                identityGraphNode._dirtyWorld = identityGraphNode._dirtyNormal = false;
                this.meshInstance = new MeshInstance(identityGraphNode, this.mesh, this.material);
                this.meshInstance.cull = false;
            }
        }
    },

    addLines: function (position, color) {
        // Append lines to buffer
        var multiColor = !!color.length;
        var offset = this.linesUsed * 2 * this.vertexFormat.size;
        var clr;
        for (var i = 0; i < position.length; i++) {
            this.vbRam.setFloat32(offset, position[i].x, true); offset += 4;
            this.vbRam.setFloat32(offset, position[i].y, true); offset += 4;
            this.vbRam.setFloat32(offset, position[i].z, true); offset += 4;
            clr = multiColor ? color[i] : color;
            this.vbRam.setUint8(offset, clr.r * 255); offset += 1;
            this.vbRam.setUint8(offset, clr.g * 255); offset += 1;
            this.vbRam.setUint8(offset, clr.b * 255); offset += 1;
            this.vbRam.setUint8(offset, clr.a * 255); offset += 1;
        }
        this.linesUsed += position.length / 2;
    },

    finalize: function () {
        // Update batch vertex buffer/issue drawcall if there are any lines
        if (this.linesUsed > 0) {
            this.vb.setData(this.vbRam.buffer);
            this.mesh.primitive[0].count = this.linesUsed * 2;
            meshInstanceArray[0] = this.meshInstance;
            this.layer.addMeshInstances(meshInstanceArray, true);
            this.linesUsed = 0;
        }
    }
});

function _initImmediate() {
    // Init global line drawing data once
    if (!this._immediateData) {
        this._immediateData = new ImmediateData(this.graphicsDevice);

        this.on('prerender', this._preRenderImmediate, this);
        this.on('postrender', this._postRenderImmediate, this);
    }
}

function _addLines(position, color, options) {
    var layer = (options && options.layer) ? options.layer : this.scene.layers.getLayerById(LAYERID_IMMEDIATE);
    var depthTest = (options && options.depthTest !== undefined) ? options.depthTest : true;
    var mask = (options && options.mask) ? options.mask : undefined;

    this._initImmediate();

    this._immediateData.addLayer(layer);

    var idx = this._immediateData.getLayerIdx(layer);
    if (idx === undefined) {
        // Init used batch once
        var batch = new LineBatch();
        batch.init(this.graphicsDevice, this._immediateData.lineVertexFormat, layer, position.length / 2);
        batch.material.depthTest = depthTest;
        if (mask) batch.meshInstance.mask = mask;

        idx = this._immediateData.lineBatches.push(batch) - 1; // push into list and get index
        this._immediateData.addLayerIdx(idx, layer);
    } else {
        // Possibly reallocate buffer if it's small
        this._immediateData.lineBatches[idx].init(this.graphicsDevice, this._immediateData.lineVertexFormat, layer, position.length / 2);
        this._immediateData.lineBatches[idx].material.depthTest = depthTest;
        if (mask) this._immediateData.lineBatches[idx].meshInstance.mask = mask;
    }
    // Append
    this._immediateData.lineBatches[idx].addLines(position, color);
}

/**
 * @function
 * @name pc.Application#renderLine
 * @description Renders a line. Line start and end coordinates are specified in
 * world-space. If a single color is supplied, the line will be flat-shaded with
 * that color. If two colors are supplied, the line will be smooth shaded between
 * those colors. It is also possible to control which scene layer the line is
 * rendered into. By default, lines are rendered into the immediate layer
 * {@link pc.LAYERID_IMMEDIATE}.
 * @param {pc.Vec3} start - The start world-space coordinate of the line.
 * @param {pc.Vec3} end - The end world-space coordinate of the line.
 * @param {pc.Color} color - The start color of the line.
 * @param {pc.Color} [endColor] - The end color of the line.
 * @param {object} [options] - Options to set rendering properties.
 * @param {pc.Layer} [options.layer] - The layer to render the line into. Defaults
 * to {@link pc.LAYERID_IMMEDIATE}.
 * @example
 * // Render a 1-unit long white line
 * var start = new pc.Vec3(0, 0, 0);
 * var end = new pc.Vec3(1, 0, 0);
 * var color = new pc.Color(1, 1, 1);
 * app.renderLine(start, end, color);
 * @example
 * // Render a 1-unit long line that is smooth-shaded from white to red
 * var start = new pc.Vec3(0, 0, 0);
 * var end = new pc.Vec3(1, 0, 0);
 * var startColor = new pc.Color(1, 1, 1);
 * var endColor = new pc.Color(1, 0, 0);
 * app.renderLine(start, end, startColor, endColor);
 * @example
 * // Render a 1-unit long white line into the world layer
 * var start = new pc.Vec3(0, 0, 0);
 * var end = new pc.Vec3(1, 0, 0);
 * var color = new pc.Color(1, 1, 1);
 * var worldLayer = app.scene.layers.getLayerById(pc.LAYERID_WORLD);
 * app.renderLine(start, end, color, {
 *     layer: worldLayer
 * });
 * @example
 * // Render a 1-unit long line that is smooth-shaded from white to red into the world layer
 * var start = new pc.Vec3(0, 0, 0);
 * var end = new pc.Vec3(1, 0, 0);
 * var startColor = new pc.Color(1, 1, 1);
 * var endColor = new pc.Color(1, 0, 0);
 * var worldLayer = app.scene.layers.getLayerById(pc.LAYERID_WORLD);
 * app.renderLine(start, end, color, {
 *     layer: worldLayer
 * });
 */
Application.prototype.renderLine = function (start, end, color) {
    var endColor = color;
    var options;

    var arg3 = arguments[3];
    var arg4 = arguments[4];

    if (arg3 instanceof Color) {
        // passed in end color
        endColor = arg3;

        if (typeof arg4 === 'number') {
            if (!_deprecationWarning) {
                console.warn("lineBatch argument is deprecated for renderLine. Use options.layer instead");
                _deprecationWarning = true;
            }
            // compatibility: convert linebatch id into options
            if (arg4 === LINEBATCH_OVERLAY) {
                options = {
                    layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                    depthTest: false
                };
            } else {
                options = {
                    layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                    depthTest: true
                };
            }
        } else {
            // use passed in options
            options = arg4;
        }
    } else if (typeof arg3 === 'number') {
        if (!_deprecationWarning) {
            console.warn("lineBatch argument is deprecated for renderLine. Use options.layer instead");
            _deprecationWarning = true;
        }

        endColor = color;

        // compatibility: convert linebatch id into options
        if (arg3 === LINEBATCH_OVERLAY) {
            options = {
                layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                depthTest: false
            };
        } else {
            options = {
                layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                depthTest: true
            };
        }
    } else if (arg3) {
        // options passed in
        options = arg3;
    }

    this._addLines([start, end], [color, endColor], options);
};

/**
 * @function
 * @name pc.Application#renderLines
 * @description Draw an array of lines.
 * @param {pc.Vec3[]} position - An array of points to draw lines between.
 * @param {pc.Color[]} color - An array of colors to color the lines. This must be the same size as the position array.
 * @param {object} [options] - Options to set rendering properties.
 * @param {pc.Layer} [options.layer] - The layer to render the line into.
 * @example
 * var points = [new pc.Vec3(0, 0, 0), new pc.Vec3(1, 0, 0), new pc.Vec3(1, 1, 0), new pc.Vec3(1, 1, 1)];
 * var colors = [new pc.Color(1, 0, 0), new pc.Color(1, 1, 0), new pc.Color(0, 1, 1), new pc.Color(0, 0, 1)];
 * app.renderLines(points, colors);
 */
Application.prototype.renderLines = function (position, color, options) {
    if (!options) {
        // default option
        options = {
            layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
            depthTest: true
        };
    } else if (typeof options === 'number') {
        if (!_deprecationWarning) {
            console.warn("lineBatch argument is deprecated for renderLine. Use options.layer instead");
            _deprecationWarning = true;
        }

        // backwards compatibility, LINEBATCH_OVERLAY lines have depthtest disabled
        if (options === LINEBATCH_OVERLAY) {
            options = {
                layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                depthTest: false
            };
        } else {
            options = {
                layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE),
                depthTest: true
            };
        }
    }

    var multiColor = !!color.length;
    if (multiColor) {
        if (position.length !== color.length) {
            console.error("renderLines: position/color arrays have different lengths");
            return;
        }
    }
    if (position.length % 2 !== 0) {
        console.error("renderLines: array length is not divisible by 2");
        return;
    }
    this._addLines(position, color, options);
};

// Draw lines forming a transformed unit-sized cube at this frame
// lineType is optional
Application.prototype.renderWireCube = function (matrix, color, options) {
    var i;

    this._initImmediate();

    // Init cube data once
    if (!this._immediateData.cubeLocalPos) {
        var x = 0.5;
        this._immediateData.cubeLocalPos = [new Vec3(-x, -x, -x), new Vec3(-x, x, -x), new Vec3(x, x, -x), new Vec3(x, -x, -x),
            new Vec3(-x, -x, x), new Vec3(-x, x, x), new Vec3(x, x, x), new Vec3(x, -x, x)];
        this._immediateData.cubeWorldPos = [new Vec3(), new Vec3(), new Vec3(), new Vec3(),
            new Vec3(), new Vec3(), new Vec3(), new Vec3()];
    }

    var cubeLocalPos = this._immediateData.cubeLocalPos;
    var cubeWorldPos = this._immediateData.cubeWorldPos;

    // Transform and append lines
    for (i = 0; i < 8; i++) {
        matrix.transformPoint(cubeLocalPos[i], cubeWorldPos[i]);
    }
    this.renderLines([
        cubeWorldPos[0], cubeWorldPos[1],
        cubeWorldPos[1], cubeWorldPos[2],
        cubeWorldPos[2], cubeWorldPos[3],
        cubeWorldPos[3], cubeWorldPos[0],

        cubeWorldPos[4], cubeWorldPos[5],
        cubeWorldPos[5], cubeWorldPos[6],
        cubeWorldPos[6], cubeWorldPos[7],
        cubeWorldPos[7], cubeWorldPos[4],

        cubeWorldPos[0], cubeWorldPos[4],
        cubeWorldPos[1], cubeWorldPos[5],
        cubeWorldPos[2], cubeWorldPos[6],
        cubeWorldPos[3], cubeWorldPos[7]
    ], color, options);
};

function _preRenderImmediate() {
    for (var i = 0; i < this._immediateData.lineBatches.length; i++) {
        if (this._immediateData.lineBatches[i]) {
            this._immediateData.lineBatches[i].finalize();
        }
    }
}

function _postRenderImmediate() {
    for (var i = 0; i < this._immediateData.layers.length; i++) {
        this._immediateData.layers[i].clearMeshInstances(true);
    }

    this._immediateData.layers.length = 0;
}

// Draw meshInstance at this frame
Application.prototype.renderMeshInstance = function (meshInstance, options) {
    if (!options) {
        options = {
            layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE)
        };
    }

    this._initImmediate();

    this._immediateData.addLayer(options.layer);

    meshInstanceArray[0] = meshInstance;
    options.layer.addMeshInstances(meshInstanceArray, true);
};

// Draw mesh at this frame
Application.prototype.renderMesh = function (mesh, material, matrix, options) {
    if (!options) {
        options = {
            layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE)
        };
    }

    this._initImmediate();
    tempGraphNode.worldTransform = matrix;
    tempGraphNode._dirtyWorld = tempGraphNode._dirtyNormal = false;

    var instance = new MeshInstance(tempGraphNode, mesh, material);
    instance.cull = false;

    if (options.mask) instance.mask = options.mask;
    this._immediateData.addLayer(options.layer);

    meshInstanceArray[0] = instance;
    options.layer.addMeshInstances(meshInstanceArray, true);
};

// Draw quad of size [-0.5, 0.5] at this frame
Application.prototype.renderQuad = function (matrix, material, options) {
    if (!options) {
        options = {
            layer: this.scene.layers.getLayerById(LAYERID_IMMEDIATE)
        };
    }

    this._initImmediate();

    // Init quad data once
    if (!this._immediateData.quadMesh) {
        var format = new VertexFormat(this.graphicsDevice, [
            { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 }
        ]);
        var quadVb = new VertexBuffer(this.graphicsDevice, format, 4);
        var iterator = new VertexIterator(quadVb);
        iterator.element[SEMANTIC_POSITION].set(-0.5, -0.5, 0);
        iterator.next();
        iterator.element[SEMANTIC_POSITION].set(0.5, -0.5, 0);
        iterator.next();
        iterator.element[SEMANTIC_POSITION].set(-0.5, 0.5, 0);
        iterator.next();
        iterator.element[SEMANTIC_POSITION].set(0.5, 0.5, 0);
        iterator.end();
        this._immediateData.quadMesh = new Mesh(this.graphicsDevice);
        this._immediateData.quadMesh.vertexBuffer = quadVb;
        this._immediateData.quadMesh.primitive[0].type = PRIMITIVE_TRISTRIP;
        this._immediateData.quadMesh.primitive[0].base = 0;
        this._immediateData.quadMesh.primitive[0].count = 4;
        this._immediateData.quadMesh.primitive[0].indexed = false;
    }

    // Issue quad drawcall
    tempGraphNode.worldTransform = matrix;
    tempGraphNode._dirtyWorld = tempGraphNode._dirtyNormal = false;

    var quad = new MeshInstance(tempGraphNode, this._immediateData.quadMesh, material);
    quad.cull = false;
    meshInstanceArray[0] = quad;

    this._immediateData.addLayer(options.layer);

    options.layer.addMeshInstances(meshInstanceArray, true);
};
