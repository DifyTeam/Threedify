// editState.js - Variáveis de estado do sistema de edição

let modoAtual = 'normal';
let submodoEdicao = 'vertex';
let vertexInstancedMesh = null;
let edgeLines = null;
let edgeHighlight = null;
let faceLines = null;
let faceHighlight = null;
let selectedVertices = [];
let selectedEdge = null;
let selectedFace = null;
let vertexCount = 0;
let editHelper = null;
let uniqueVertices = [];
let vertexMapping = {};
let edges = [];
let faces = [];
let initialEditPosition = null;
let selectedUniqueIndices = [];
let initialVertexPositions = {};

// Variáveis para ferramentas
let loopCutMode = false;
let loopCutPreviewLine = null;
let loopCutCurrentLoop = null;
let extrusionAmount = 0.5;