// src/geometry/index.js — public surface of the 2D geometry module (SPEC section 5). Pure: imports only src/core
// (types.js, ids.js hashString, fabrics.js effectiveMeshSpacing) through the sibling files. No DOM, no three.

export {
  cubicPoint, cubicTangent, cubicLengthTable, segmentLength, edgeLength, paramAtArcFraction, pointAtArcFraction,
  tangentAtArcFraction, sampleSegment, sampleEdge, sampleSegmentAt, splitCubic, splitEdge, flattenSegment, flattenPiece,
  clonePiece,
} from './bezier.js';

export {
  signedArea, isCCW, ensureCCW, reverseOutline, segmentsIntersect, segmentsCross, lineIntersection, isSimplePolygon,
  pointInPolygon, distToSegment, distToPolyline, bbox, centroid, polylineLength, resamplePolyline, translatePoints,
  scalePoints, geometryError,
} from './polygon.js';

export { fullOutline, mirrorPoint, mirrorPiece } from './mirror.js';

export { mulberry32, jitterSeed } from './prng.js';

export { delaunay, recoverEdges, buildAdjacency, edgeKey } from './delaunay.js';

export { effectiveSpacing, effectiveSpacingDetailed, seamSampleFractions, remeshPiece } from './remesh.js';

export { offsetPolygon, offsetOutline } from './offset.js';

export { packRects } from './pack.js';
