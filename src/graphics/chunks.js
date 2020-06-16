import {
    SEMANTIC_POSITION, SEMANTIC_NORMAL, SEMANTIC_TANGENT, SEMANTIC_TEXCOORD0, SEMANTIC_TEXCOORD1, SEMANTIC_TEXCOORD2,
    SEMANTIC_TEXCOORD3, SEMANTIC_TEXCOORD4, SEMANTIC_TEXCOORD5, SEMANTIC_TEXCOORD6, SEMANTIC_TEXCOORD7,
    SEMANTIC_COLOR, SEMANTIC_BLENDINDICES, SEMANTIC_BLENDWEIGHT
} from './graphics.js';
import { programlib } from './program-lib/program-lib.js';
import { Shader } from './shader.js';

/**
 * @static
 * @readonly
 * @type {object}
 * @name pc.shaderChunks
 * @description Object containing all default shader chunks used by shader generators.
 */
var shaderChunks = {};

var attrib2Semantic = {
    vertex_position: SEMANTIC_POSITION,
    vertex_normal: SEMANTIC_NORMAL,
    vertex_tangent: SEMANTIC_TANGENT,
    vertex_texCoord0: SEMANTIC_TEXCOORD0,
    vertex_texCoord1: SEMANTIC_TEXCOORD1,
    vertex_texCoord2: SEMANTIC_TEXCOORD2,
    vertex_texCoord3: SEMANTIC_TEXCOORD3,
    vertex_texCoord4: SEMANTIC_TEXCOORD4,
    vertex_texCoord5: SEMANTIC_TEXCOORD5,
    vertex_texCoord6: SEMANTIC_TEXCOORD6,
    vertex_texCoord7: SEMANTIC_TEXCOORD7,
    vertex_color: SEMANTIC_COLOR,
    vertex_boneIndices: SEMANTIC_BLENDINDICES,
    vertex_boneWeights: SEMANTIC_BLENDWEIGHT
};

shaderChunks.collectAttribs = function (vsCode) {
    var attribs = {};
    var attrs = 0;

    var found = vsCode.indexOf("attribute");
    while (found >= 0) {
        if (found > 0 && vsCode[found - 1] === "/") break;
        var endOfLine = vsCode.indexOf(';', found);
        var startOfAttribName = vsCode.lastIndexOf(' ', endOfLine);
        var attribName = vsCode.substr(startOfAttribName + 1, endOfLine - (startOfAttribName + 1));

        var semantic = attrib2Semantic[attribName];
        if (semantic !== undefined) {
            attribs[attribName] = semantic;
        } else {
            attribs[attribName] = "ATTR" + attrs;
            attrs++;
        }

        found = vsCode.indexOf("attribute", found + 1);
    }
    return attribs;
};


shaderChunks.createShader = function (device, vsName, psName, useTransformFeedback) {
    var vsCode = shaderChunks[vsName];
    var psCode = programlib.precisionCode(device) + "\n" + shaderChunks[psName];
    var attribs = this.collectAttribs(vsCode);

    if (device.webgl2) {
        vsCode = programlib.versionCode(device) + this.gles3VS + vsCode;
        psCode = programlib.versionCode(device) + this.gles3PS + psCode;
    }

    return new Shader(device, {
        attributes: attribs,
        vshader: vsCode,
        fshader: psCode,
        useTransformFeedback: useTransformFeedback
    });
};

shaderChunks.createShaderFromCode = function (device, vsCode, psCode, uName, useTransformFeedback) {
    var shaderCache = device.programLib._cache;
    var cached = shaderCache[uName];
    if (cached !== undefined) return cached;

    psCode = programlib.precisionCode(device) + "\n" + (psCode || programlib.dummyFragmentCode());
    var attribs = this.collectAttribs(vsCode);

    if (device.webgl2) {
        vsCode = programlib.versionCode(device) + this.gles3VS + vsCode;
        psCode = programlib.versionCode(device) + this.gles3PS + psCode;
    }

    shaderCache[uName] = new Shader(device, {
        attributes: attribs,
        vshader: vsCode,
        fshader: psCode,
        useTransformFeedback: useTransformFeedback
    });
    return shaderCache[uName];
};

export { shaderChunks };