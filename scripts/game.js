require(["ramda", "webgl_helpers", "functional_utils"], function(r, w, fun) {
    "use strict";

    //Constants
    const minSegLen = 0.025;
    const maxSegLen = 0.15;
    const minGroundHeight = 0.1;
    const maxGroundHeight = 0.45;
    const flatChance = 0.6;
    const gravity = [0, -0.2];
    const ballRadius = 0.01;
    const ballSectors = 16;
    const bounceLoss = 0.3;
    const canvas = document.getElementById("canvas");
    const xpx = canvas.clientWidth;
    const ypx = canvas.clientHeight;
    const shotStrength = 1.5;
    const holeFlatWidth = 0.01;
    const halfHoleWidth = 0.02;
    const holeWidth = holeFlatWidth + halfHoleWidth;
    const holeDepth = 0.05;
    const holePattern = [
        [-holeFlatWidth - halfHoleWidth, 0], [-halfHoleWidth, 0],
        [-halfHoleWidth, -holeDepth], [halfHoleWidth, -holeDepth],
        [halfHoleWidth, 0], [holeFlatWidth + halfHoleWidth, 0]];
    const gameSpeed = 0.0022;
    const particleSize = 8;
    const numParticles = 150;
    const numTrails = 10;
    const explosionSpeed = 0.1;
    const numExplosions = 5;
    const velocityThreshold = 0.02;
    const toGroundThreshold = 0.002;
    //These are in milliseconds.
    const explosionLife = 1100;
    const explosionInterval = 200;
    const newHoleDelay = 200; //after explosions

    //State
    let program;
    let gl;
    let ballPosition;
    let startingPosition;
    let ballVelocity = [0, 0];
    let lastTimestamp;
    let currentLandscape;
    let ballStill = true;
    let shooting = false;
    let celebrating = false;
    let aimStartPos;
    let aimEndPos;
    let bottomOfHole;
    let shots = 0;
    let completed = 0;
    let explosions = [];
    let trailTimer = 0;
    let trailTimerLimit = 20;

    const translationMat = function (translation) {
        return [[1, 0, translation[0]],
               [0, 1, translation[1]],
               [0, 0, 1]];
    };

    const rotationMat = function (angle) {
        let c = Math.cos(angle);
        let s = Math.sin(angle);
        return [[c, -s, 0],
               [s, c, 0],
               [0, 0, 1]];
    };

    const scaleMat = function (scale) {
        if (typeof scale === "number") {
            scale = [scale, scale];
        }
        return [[scale[0], 0, 0],
               [0, scale[1], 0],
               [0, 0, 1]];
    };

    const transpose = function(matrix) {
        return fun.apply(fun.map, fun.array, matrix);
    };

    const matrixMul = function () {
        const mul2 = function(a, b) {
            let tb = transpose(b);
            let result = [];
            for (const row of a) {
                for (const col of tb) {
                    result.push(dot(row, col));
                }
            }
            return fun.partition(3, result);
        };
        return fun.reduce(mul2, arguments);
    };

    const rotateVec = function(v, angle) {
        let x = v[0];
        let y = v[1];
        return [x * Math.cos(angle) - y * Math.sin(angle),
               x * Math.sin(angle) + y * Math.cos(angle)];
    };

    const add = function() {
        return r.reduce(function (x, y) {return x + y;}, 0, arguments);
    };

    const sub = function() {
        const sub2 = function (x, y) {return x - y;};
        if (arguments.length < 2) {
            return r.reduce(sub2, 0, arguments);
        }
        return fun.reduce(sub2, arguments);
    };

    const mul = function() {
        return r.reduce(function (x, y) {return x * y;}, 1, arguments);
    };

    const scaleVec = function(s, v) {
        return r.map(r.multiply(s), v);
    };

    const vecAdd = function(u, v) {
        return fun.map(add, u, v);
    };

    const vecSub = function(u, v) {
        return fun.map(sub, u, v);
    };

    const magnitude = function(v) {
        let sq = function(x) {return x * x;};
        return Math.sqrt(r.apply(add, r.map(sq, v)));
    };

    const normalize = function(v) {
        return scaleVec(1 / magnitude(v), v);
    };

    const dot = function(u, v) {
        return r.apply(add, fun.map(mul, u, v));
    };

    const angleBetween = function(u, v) {
        return Math.acos(dot(normalize(u), normalize(v)));
    };

    const signedAngleBetween = function(u, v) {
        u = normalize(u);
        v = normalize(v);
        return Math.asin(u[0] * v[1] - u[1] * v[0]);
    };

    const linesIntersect = function(l1, l2) {
        let points = [l1[0], l2[0], l1[1], l2[1]];
        for (let i = 0; i < 4; i++) {
            let p = points[i];
            //These are the vectors to the 3 other points from p,
            //vo being to the point on the same line as p.
            let v1 = vecSub(points[(i + 1) % 4], p);
            let vo = vecSub(points[(i + 2) % 4], p);
            let v2 = vecSub(points[(i + 3) % 4], p);
            let angle12 = angleBetween(v1, v2);
            let angleo1 = angleBetween(vo, v1);
            let angleo2 = angleBetween(vo, v2);
            //The angle between v1 and v2 can not be smaller than the angle
            //between vo and v1 or vo and v2, because the vector vo (to the
            //point on the same line as p) has to be in the middle.
            if (angle12 < angleo1 || angle12 < angleo2) {
                return false;
            }
        }
        return true;
    };



    const LIMIT_RANDOM_NUMBER_32_BIT_INT=4294967296+1

    const  getSecureRandomNumber = function() {
        const array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        let randomNumber = array[0]/LIMIT_RANDOM_NUMBER_32_BIT_INT;
        return randomNumber;
    };

    const rand = function(min, max) {
        let secureRandomNumber=getSecureRandomNumber()
        if (max === undefined) {
            max = min;
            min = 0;
        }
        return min + secureRandomNumber* (max - min);
    };

    const chance = function(chance) {
        return rand(1) < chance;

    };

    const randomPoint = function() {
        return [rand(minSegLen, maxSegLen),
               rand(minGroundHeight, maxGroundHeight)];
    };

    //flatChance === 1 means every second segment becomes flat.
    const insertFlatSegments = function(flatChance, points) {
        return fun.mapcat(
                function (p) {
                    return chance(flatChance) ? [p, [rand(minSegLen, maxSegLen), p[1]]] : [p];
                },
                points);
    };

    const epilocation = function(pos, ground) {
        let x = pos[0];
        let line = function findLine(i) {
            if (ground[i][0] > x) {
                return [ground[i - 1], ground[i]];
            }
            return findLine(i + 1);
        }(0);
        let p = line[0];
        let q = line[1];
        let y = p[1] + (x - p[0]) / (q[0] - p[0]) * (q[1] - p[1]);
        return [x, y];
    };

    const distanceToGround = function(pos, ground) {
        return magnitude(vecSub(pos, epilocation(pos, ground)));
    };

    const landscape = function() {
        let points = insertFlatSegments(flatChance,
                fun.cons([0, 0.4],
                    fun.repeatedly(1 / minSegLen + 1, randomPoint)));
        let lastPoint = points[0];
        return r.map(
                function(p) {
                    let newX = p[0] + lastPoint[0];
                    let newP = r.update(0, newX, p);
                    lastPoint = newP;
                    return newP;
                },
                points);
    };

    const toGlslFormat = function(matrix) {
        return r.flatten(transpose(matrix));
    };

    const drawGraphics = function(vertices, mode, color, transformation) {
        transformation = transformation || {};
        let translation = transformation.translation || [0, 0];
        let rotation = transformation.rotation || 0;
        let scale = transformation.scale || 1;
        let matrix = matrixMul(
                translationMat(translation),
                rotationMat(rotation),
                scaleMat(scale));

        let matrixLoc = gl.getUniformLocation(program, "u_matrix");
        gl.uniformMatrix3fv(matrixLoc, gl.FALSE, toGlslFormat(matrix));
        let colorLoc = gl.getUniformLocation(program, "u_color");
        gl.uniform3fv(colorLoc, color);
        let particleSizeLoc = gl.getUniformLocation(program, "u_pointSize");
        gl.uniform1f(particleSizeLoc, particleSize);
        let useTextureLoc = gl.getUniformLocation(program, "u_useTexture");
        gl.uniform1i(useTextureLoc, mode === gl.POINTS ? 1 : 0);

        let positionLoc = gl.getAttribLocation(program, "a_position");
        let buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices),
                gl.STATIC_DRAW);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(mode, 0, r.length(vertices) / 2);
    };

    const drawBall = function() {
        const pointOnCircle = function(angle) {
            return [Math.cos(angle), Math.sin(angle)];
        };

        let ballPoints = r.map(pointOnCircle,
                r.map(function (factor) {return 2 * Math.PI / ballSectors * factor;},
                    r.range(0, ballSectors)));

        ballPoints = r.map(r.partial(scaleVec, ballRadius), ballPoints);

        drawGraphics(r.flatten(ballPoints), gl.TRIANGLE_FAN, [1, 1, 1], {
            translation: ballPosition});
    };

    const drawGround = function() {
        const pointsForDrawing = function(pair) {
            let p = pair[0];
            let q = pair[1];
            let bp = [p[0], 0];
            let bq = [q[0], 0];
            return [p, q, bp,
                   bq, bp, q];
        };

        let pairs = fun.partition(2, 1, currentLandscape);
        let vertices = r.flatten(r.map(pointsForDrawing, pairs));
        drawGraphics(vertices, gl.TRIANGLES, [0, 0.9, 0]);
    };

    const drawAimLine = function() {
        let aimEndPosVector = vecSub(aimEndPos, aimStartPos);
        let line = [ballPosition, vecAdd(ballPosition, aimEndPosVector)];
        drawGraphics(r.flatten(line), gl.LINES, [1, 1, 0]);
    };

    const drawFlag = function() {
        let w = 0.004;
        let h = 0.09;
        let fh = 0.03;
        let fl = 0.04;
        let pole = [[-w, h], [w, h], [-w, 0],
            [w, h], [-w, 0], [w, 0]];
        let flag = [[w, h], [w + fl, h - fh / 2], [w, h - fh]];
        let transformation = {translation: bottomOfHole};
        drawGraphics(r.flatten(pole), gl.TRIANGLES, [0.8, 0.4, 0.2],
                transformation);
        drawGraphics(r.flatten(flag), gl.TRIANGLES, [1, 0, 0],
                transformation);
    };

    const drawExplosion = function(exp) {
        const pos = function(p) {
            return p.position;
        };
        let transformation = {translation: exp.position};
        drawGraphics(r.flatten(r.map(pos, exp.particles)), gl.POINTS, [1, 1, 0],
                transformation);
    };

    const drawScene = function() {
        gl.clearColor(0.5, 0.5, 1.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawGround();
        drawFlag();
        if (shooting) {
            drawAimLine();
        }
        drawBall();
        explosions.forEach(drawExplosion);
    };

    const updateScore = function() {
        document.getElementById("hole").innerHTML = (completed + 1);
        document.getElementById("shots").innerHTML = shots;
        document.getElementById("per-hole").innerHTML = shots / (completed + 1);
    };

    const setupHole = function() {
        let land = landscape();
        let pointsNeeded = r.length(r.takeWhile(function (p) {return p[0] < 1;},
                    land)) + 1;
        land = r.take(pointsNeeded, land);

        startingPosition = ballPosition = fun.updateNumber(1, 0.001,
                epilocation([0.1, 1], land));

        let holePos = epilocation([rand(0.7, 0.9), 1], land);
        bottomOfHole = fun.updateNumber(1, -holeDepth, holePos);
        let before = [];
        let after = land;
        let hole = r.map(r.partial(vecAdd, holePos), holePattern);
        currentLandscape = function insertHole(holeX) {
            if (after[0][0] > holeX) {
                before = function fixBefore(before) {
                    if (fun.last(before)[0] + holeWidth > holeX) {
                        return fixBefore(fun.butlast(before));
                    }
                    return before;
                }(before);

                after = function fixAfter(after) {

                    if (fun.first(after)[0] - holeWidth < holeX) {
                        return fixAfter(fun.rest(after));
                    }
                    return after;
                }(after);

                return fun.concat(before, hole, after);

            } else {
                before.push(after[0]);
                after = fun.rest(after);
            }
            return insertHole(holeX);
        }(holePos[0]);
    };

    const mouseLocation = function(e) {
        return [e.layerX / xpx, 1 - e.layerY / ypx]
    };

    const beginShooting = function(e) {
        if (ballStill && !celebrating) {
            shooting = true;
            aimStartPos = mouseLocation(e);
        };
    };

    const shoot = function(e) {
        if (shooting) {
            shooting = false;
            ballStill = false;
            let loc = mouseLocation(e);
            ballVelocity = scaleVec(shotStrength, vecSub(loc, aimStartPos));
            shots += 1;
            updateScore();
        };
    };

    const aim = function(e) {
        aimEndPos = mouseLocation(e);
    };

    const inHole = function(ball, hole) {
        return magnitude(vecSub(ball, hole)) <= halfHoleWidth;
    };

    const outOfBounds = function(pos) {
        let x = pos[0];
        return x <= 0 || x >= 1;
    };

    const addDeltaVector = function(delta, addition, to) {
        return vecAdd(scaleVec(delta, addition), to);
    };

    const bounce = function(delta) {
        if (outOfBounds(ballPosition)) {
            ballPosition = startingPosition;
            ballVelocity = [0, 0];
            ballStill = true;
            return;
        };

        const findIntersectingSegment = function(line) {
            return fun.first(r.filter(r.partial(linesIntersect, line),
                        fun.partition(2, 1, currentLandscape)));
        };

        const addDeltaVectorPrim = r.partial(addDeltaVector, delta);

        ballVelocity = addDeltaVectorPrim(gravity, ballVelocity);

        const calculateVelocity = function(velocity) {
            let toGround = distanceToGround(ballPosition, currentLandscape);
            if (magnitude(velocity) < velocityThreshold &&
                    toGround < toGroundThreshold) {
                ballStill = true;
                return [0, 0];
            }

            let newPosition = addDeltaVectorPrim(velocity, ballPosition);

            let line = findIntersectingSegment([ballPosition, newPosition]);
            if (line) {
                let surface = vecSub(line[1], line[0]);
                let normal = rotateVec(surface, Math.PI / 2);
                let reflectedVelocity = scaleVec(-1, velocity);
                let angle = signedAngleBetween(reflectedVelocity, normal);

                velocity = scaleVec(1 - bounceLoss,
                        rotateVec(reflectedVelocity, 2 * angle));
                return calculateVelocity(velocity);
            }
            return velocity;
        };

        ballVelocity = calculateVelocity(ballVelocity);
        ballPosition = addDeltaVectorPrim(ballVelocity, ballPosition);
    };

    const createParticle = function() {
        let rand1 = r.partial(rand, -1, 1);
        return {position: scaleVec(0.01, [rand1(), rand1()]),
            //Normalize a 3D vector to make the explosion look 3D
            velocity: fun.butlast(normalize([rand1(), rand1(), rand1()]))};
    };

    const createExplosion = function(pos) {
        return {position: pos,
            particles: fun.repeatedly(numParticles, createParticle),
            explosionTime: 0,
            timeToLive: explosionLife};
    };

    const updateParticle = function(delta, explosionTime, p) {
        //The speed of particles should decrease with time after explosion.
        let speed = explosionSpeed / (Math.pow(explosionTime / 500 , 2) + 1);
        //Multiply by game speed to make gravity and velocity calculations
        //similar to the ball's.
        delta *= gameSpeed;
        //Divide gravity increase by speed to counteract
        //the slowing down of gravity.
        //Repetition (verbosity) below is an optimization.
        p.velocity[1] += delta / speed * gravity[1] / 10;
        p.position[0] += delta * speed * p.velocity[0];
        p.position[1] += delta * speed * p.velocity[1];
        return p;
    };

    const spawnTrails = function(particles) {
        const copy = function(p) {
            return {position: r.map(r.identity, p.position),
                velocity: [0, 0]};
        };

        particles = fun.concat(particles,
                r.map(copy, r.slice(0, numParticles, particles)));

        if (particles.length > numParticles * numTrails) {
            particles = fun.concat(
                    r.slice(0, numParticles, particles),
                    r.slice(2 * numParticles, (2 + numTrails) * numParticles, particles));
        };
        return particles;
    };

    const updateExplosion = function(delta, exp) {
        //Explosions are completely removed after the celebration.
        if (exp.timeToLive <= 0) {
            exp.particles = [];
            return exp;
        };
        exp.timeToLive -= delta;
        exp.explosionTime += delta;
        if (trailTimer > trailTimerLimit) {
            exp.particles = spawnTrails(exp.particles);
        };
        exp.particles = r.map(
                r.partial(updateParticle, delta, exp.explosionTime),
                exp.particles);
        return exp;
    };

    const celebrate = function() {
        celebrating = true;
        let duration = (numExplosions - 1) * explosionInterval +
            explosionLife + newHoleDelay;
        let celebrationTime = 0;
        let lastUpdate = performance.now();
        let spawnedExplosions = 0;

        const runCelebration = function(now) {
            let delta = now - lastUpdate;
            lastUpdate = now;

            celebrationTime += delta;
            if (celebrationTime > explosionInterval * spawnedExplosions) {
                let pos = [0.7 + rand(-0.2, 0.2),
                    0.8 + rand(-0.1, 0.1)];
                if (spawnedExplosions < numExplosions) {
                    explosions.push(createExplosion(pos));
                    spawnedExplosions += 1;
                }
            };

            trailTimer += delta;
            explosions.forEach(r.partial(updateExplosion, delta));
            if (trailTimer > trailTimerLimit) {
                trailTimer -= trailTimerLimit;
            }

            drawScene();

            if (celebrationTime > duration) {
                celebrating = false;
                explosions = [];
                setupHole();
                window.requestAnimationFrame(mainLoop);
            } else {
                window.requestAnimationFrame(runCelebration);
            }
        };

        window.requestAnimationFrame(runCelebration);
    };

    const logic = function(delta) {
        delta *= gameSpeed;

        if (!ballStill) {
            bounce(delta);
        }
        if (ballStill && inHole(ballPosition, bottomOfHole)) {
            completed += 1;
            celebrate();
            updateScore();
        }
    };

    const gaussian = function(x) {
        let c = 0.3;
        return Math.exp(-x * x / (2 * c * c));
    };

    const gaussianTexture = function(size) {
        let result = [];
        let mid = size/2 - 0.5;
        mid = [mid, mid];
        let distToEdge = magnitude(mid);
        const color = function(alpha) {
            alpha *= 0.1;
            const timesAlpha = function (x) {
                return Math.floor(x * alpha);
            };
            return [255, 100 + timesAlpha(155),
                   timesAlpha(255 * alpha), timesAlpha(255)];
        };
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                result.push(color(gaussian(
                                magnitude(vecSub([x, y], mid)) / distToEdge)));
            }
        }
        return result;
    };

    const makeParticleTexture = function(gl) {
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, particleSize, particleSize, 0,
                gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array(r.flatten(gaussianTexture(particleSize))));
        gl.generateMipmap(gl.TEXTURE_2D);
    };

    const mainLoop = function(now) {
        let delta = now - lastTimestamp;
        lastTimestamp = now;

        if (celebrating) {
            return;
        }

        logic(delta);
        drawScene();
        window.requestAnimationFrame(mainLoop);
    };

    const main = function() {
        canvas.onmousemove = aim;
        canvas.onmousedown = beginShooting;
        canvas.onmouseup = shoot;

        gl = canvas.getContext("webgl");
        program = w.programFromScripts(gl, "vshader", "fshader");
        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        makeParticleTexture(gl);

        lastTimestamp = performance.now();
        setupHole();

        window.requestAnimationFrame(mainLoop);
    };

    main();
});
