/**
 * Parse the PostgREST OpenAPI spec into structured table/column/rpc metadata.
 * Supports both OpenAPI 2.0 (swagger, definitions) and 3.0 (openapi, components.schemas).
 */

export function parseOpenApiSpec(spec) {
  if (!spec) return { tables: [], rpcs: [] };

  // Resolve definitions: OpenAPI 2.0 uses `definitions`, 3.0 uses `components.schemas`
  const definitions = spec.definitions || spec.components?.schemas || {};

  if (Object.keys(definitions).length === 0 && !spec.paths) {
    return { tables: [], rpcs: [] };
  }

  return {
    tables: parseTables(definitions),
    rpcs: parseRpcs(spec)
  };
}

/**
 * Extract table names from spec (used by SecurityTab independently of full parse).
 */
export function extractTableNames(spec) {
  if (!spec) return [];

  // Try from paths first (works for both OpenAPI 2.0 and 3.0)
  if (spec.paths) {
    const fromPaths = Object.keys(spec.paths)
      .map(path => path.replace(/^\//, ''))
      .filter(name => name && !name.startsWith('rpc/'));
    if (fromPaths.length > 0) return fromPaths;
  }

  // Fallback to definitions/schemas
  const definitions = spec.definitions || spec.components?.schemas || {};
  return Object.keys(definitions).sort();
}

/**
 * Extract table definitions.
 */
function parseTables(definitions) {
  const tables = [];

  for (const [name, def] of Object.entries(definitions)) {
    if (!def.properties) continue;

    const requiredFields = new Set(def.required || []);
    const columns = [];

    for (const [colName, colDef] of Object.entries(def.properties)) {
      // Resolve $ref if present (OpenAPI 3.0 may use refs for enums/types)
      const resolved = colDef.$ref ? {} : colDef;

      columns.push({
        name: colName,
        type: resolved.type || 'unknown',
        format: resolved.format || null,
        nullable: !requiredFields.has(colName),
        primaryKey: isPrimaryKey(resolved.description),
        description: resolved.description || null,
        maxLength: resolved.maxLength || null,
        default: resolved.default || null,
        enum: resolved.enum || null,
        foreignKey: parseForeignKey(resolved.description)
      });
    }

    // Find PK: explicit from description, or fall back to heuristics
    let pk = columns.find(c => c.primaryKey)?.name || null;
    if (!pk) {
      const idCol = columns.find(c => c.name === 'id' && requiredFields.has('id'));
      if (idCol) {
        idCol.primaryKey = true;
        pk = 'id';
      } else {
        const candidate = columns.find(c =>
          requiredFields.has(c.name) && (c.format === 'uuid' || c.type === 'integer' || c.format === 'bigint')
        );
        if (candidate) {
          candidate.primaryKey = true;
          pk = candidate.name;
        }
      }
    }

    tables.push({
      name,
      columns,
      primaryKey: pk
    });
  }

  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract RPC function definitions from /rpc/ paths.
 * Handles both OpenAPI 2.0 (parameters in body) and 3.0 (requestBody).
 */
function parseRpcs(spec) {
  const rpcs = [];

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    if (!path.startsWith('/rpc/')) continue;
    const name = path.replace('/rpc/', '');
    const post = methods.post;
    if (!post) continue;

    let props = {};
    let requiredList = [];

    // OpenAPI 2.0: parameters with in=body
    const bodyParam = post.parameters?.find(p => p.in === 'body');
    if (bodyParam?.schema?.properties) {
      props = bodyParam.schema.properties;
      requiredList = bodyParam.schema.required || [];
    }

    // OpenAPI 3.0: requestBody.content.application/json.schema
    if (Object.keys(props).length === 0 && post.requestBody) {
      const jsonSchema = post.requestBody.content?.['application/json']?.schema;
      if (jsonSchema?.properties) {
        props = jsonSchema.properties;
        requiredList = jsonSchema.required || [];
      }
    }

    const required = new Set(requiredList);

    const parameters = Object.entries(props).map(([pName, pDef]) => ({
      name: pName,
      type: pDef.type || 'string',
      format: pDef.format || null,
      required: required.has(pName)
    }));

    rpcs.push({ name, parameters });
  }

  return rpcs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Detect primary key from PostgREST column description.
 */
function isPrimaryKey(description) {
  if (!description) return false;
  const d = description.toLowerCase();
  return d.includes('primary key') || d.includes('<pk') || d.includes('primary_key');
}

/**
 * Try to parse FK info from PostgREST column description.
 */
function parseForeignKey(description) {
  if (!description) return null;
  const match = description.match(/Foreign Key to `(\w+)\.(\w+)`/i);
  if (match) return { table: match[1], column: match[2] };
  return null;
}
