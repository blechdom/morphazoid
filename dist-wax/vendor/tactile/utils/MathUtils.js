/**
 * Mathematical Utility Functions
 * Comprehensive math operations used across the tactile.js library and spiral demos
 * Merged from main lib and spiral demo utilities
 */

// =============================================================================
// Vector Operations
// =============================================================================

/**
 * Vector subtraction
 * @param {Object} V - First vector with x,y properties  
 * @param {Object} W - Second vector with x,y properties
 * @returns {Object} Result vector with x,y properties
 */
export function sub(V, W) { 
    return { x: V.x - W.x, y: V.y - W.y }; 
}

/**
 * Vector dot product
 * @param {Object} V - First vector with x,y properties
 * @param {Object} W - Second vector with x,y properties  
 * @returns {number} Dot product result
 */
export function dot(V, W) { 
    return V.x * W.x + V.y * W.y; 
}

/**
 * Vector length/magnitude
 * @param {Object} V - Vector with x,y properties
 * @returns {number} Length of the vector
 */
export function len(V) { 
    return Math.sqrt(dot(V, V)); 
}

/**
 * Distance between two points
 * @param {Object} V - First point with x,y properties
 * @param {Object} W - Second point with x,y properties
 * @returns {number} Distance between points
 */
export function ptdist(V, W) { 
    return len(sub(V, W)); 
}

/**
 * Vector normalization (unit vector)
 * @param {Object} V - Vector with x,y properties
 * @returns {Object} Normalized vector with x,y properties
 */
export function normalize(V) {
    const l = len(V);
    return { x: V.x / l, y: V.y / l };
}

/**
 * Vector scaling
 * @param {Object} v - Vector with x,y properties
 * @param {number} a - Scale factor
 * @returns {Object} Scaled vector with x,y properties
 */
export function scaleVec(v, a) {
    return { x: v.x * a, y: v.y * a };
}

// =============================================================================
// Matrix Operations
// =============================================================================

/**
 * Matrix multiplication function
 * Handles both Matrix * Point and Matrix * Matrix operations
 * 
 * @param {Array|Object} A - First matrix (6-element array) or point object
 * @param {Array|Object} B - Second matrix (6-element array) or point object  
 * @returns {Array|Object} Result matrix array or point object
 */
export function mul(A, B) {
    if (B.hasOwnProperty('x')) {
        // Matrix * Point
        return { 
            x: A[0]*B.x + A[1]*B.y + A[2],
            y: A[3]*B.x + A[4]*B.y + A[5] 
        };
    } else {
        // Matrix * Matrix
        return [
            A[0]*B[0] + A[1]*B[3], 
            A[0]*B[1] + A[1]*B[4],
            A[0]*B[2] + A[1]*B[5] + A[2],
            A[3]*B[0] + A[4]*B[3], 
            A[3]*B[1] + A[4]*B[4],
            A[3]*B[2] + A[4]*B[5] + A[5]
        ];
    }
}

/**
 * Matrix inversion for 2D transformation matrices
 * @param {Array} T - 6-element transformation matrix [a,b,c,d,e,f]
 * @returns {Array} Inverted transformation matrix
 */
export function inv(T) {
    const det = T[0] * T[4] - T[1] * T[3];
    return [
        T[4] / det, 
        -T[1] / det, 
        (T[1] * T[5] - T[2] * T[4]) / det,
        -T[3] / det, 
        T[0] / det, 
        (T[2] * T[3] - T[0] * T[5]) / det
    ];
}

/**
 * Match segment transformation
 * Creates a transformation matrix to match segment p-q
 * @param {Object} p - Start point with x,y properties
 * @param {Object} q - End point with x,y properties  
 * @returns {Array} 6-element transformation matrix
 */
export function matchSeg(p, q) {
    return [q.x-p.x, p.y-q.y, p.x, q.y-p.y, q.x-p.x, p.y];
}

// =============================================================================
// Point/Matrix Creation Utilities
// =============================================================================

/**
 * Create a simple point object
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate  
 * @returns {Object} Point object with x,y properties
 */
export function createPoint(x, y) {
    return { x, y };
}

/**
 * Create a simple transformation matrix
 * @param {number} a - Matrix element [0]
 * @param {number} b - Matrix element [1]  
 * @param {number} c - Matrix element [2]
 * @param {number} d - Matrix element [3]
 * @param {number} e - Matrix element [4]
 * @param {number} f - Matrix element [5]
 * @returns {Array} 6-element transformation matrix
 */
export function createMatrix(a, b, c, d, e, f) {
    return [a, b, c, d, e, f];
}

// =============================================================================
// Geometric Utilities
// =============================================================================

/**
 * Calculate distance from a point to a line segment
 * @param {Object} P - Point with x,y properties
 * @param {Object} A - Line segment start point with x,y properties
 * @param {Object} B - Line segment end point with x,y properties
 * @returns {number} Distance from point to line segment
 */
export function distToSeg(P, A, B) {
    const qmp = sub(B, A);
    const t = dot(sub(P, A), qmp) / dot(qmp, qmp);
    if ((t >= 0.0) && (t <= 1.0)) {
        return len(sub(P, { x: A.x + t * qmp.x, y: A.y + t * qmp.y }));
    } else if (t < 0.0) {
        return ptdist(P, A);
    } else {
        return ptdist(P, B);
    }
}

// =============================================================================
// Default Export
// =============================================================================

export default { 
    // Vector operations
    sub, dot, len, ptdist, normalize, scaleVec,
    // Matrix operations  
    mul, inv, matchSeg,
    // Point/Matrix creation
    createPoint, createMatrix,
    // Geometric utilities
    distToSeg
};