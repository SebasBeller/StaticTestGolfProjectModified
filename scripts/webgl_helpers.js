define(function() {
    "use strict";

    const w = {};

    w.compileShader = function(gl, shaderSource, shaderType) {
        const shader = gl.createShader(shaderType);
        gl.shaderSource(shader, shaderSource);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!success) {
            throw new Error("could not compile shader:" + gl.getShaderInfoLog(shader));
        }
        return shader;
    };
    
    w.createProgram = function(gl, vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        const success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (!success) {
            throw new Error("program failed to link:" + gl.getProgramInfoLog(program));
        }
        return program;
    };


    w.shaderFromScript = function(gl, scriptId, opt_shaderType) {
        const shaderText = document.getElementById(scriptId).text;
        return w.compileShader(gl, shaderText, opt_shaderType);
    };

    w.programFromScripts = function(gl, vertex, fragment) {
        return w.createProgram(gl,
                w.shaderFromScript(gl, vertex, gl.VERTEX_SHADER),
                w.shaderFromScript(gl, fragment, gl.FRAGMENT_SHADER));
    };

    return w;
});
