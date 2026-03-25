/**
 * Parse the PostgREST OpenAPI spec into structured table/column/rpc metadata.
 */

export function parseOpenApiSpec(spec) {
  if (!spec || !spec.definitions) return { tables: [], rpcs: [] };

  return {
    tables: parseTables(spec),
    rpcs: parseRpcs(spec)
  };
}

/**
 * Extract table definitions.
 * Returns: [{ name, columns: [{ name, type, format, nullable, primaryKey, description, maxLength, foreignKey }], primaryKey }]
 */
function parseTables(spec) {
  const tables = [];

  for (const [name, def] of Object.entries(spec.definitions || {})) {
    if (!def.properties) continue;

    const requiredFields = new Set(def.required || []);
    const columns = [];

    for (const [colName, colDef] of Object.entries(def.properties)) {
      columns.push({
        name: colName,
        type: colDef.type || 'unknown',
        format: colDef.format || null,
        nullable: !requiredFields.has(colName),
        primaryKey: isPrimaryKey(colDef.description),
        description: colDef.description || null,
        maxLength: colDef.maxLength || null,
        default: colDef.default || null,
        enum: colDef.enum || null,
        foreignKey: parseForeignKey(colDef.description)
      });
    }

    // Find PK: explicit from description, or fall back to 'id' if it's required, or first required column
    let pk = columns.find(c => c.primaryKey)?.name || null;
    if (!pk) {
      const idCol = columns.find(c => c.name === 'id' && requiredFields.has('id'));
      if (idCol) {
        idCol.primaryKey = true;
        pk = 'id';
      } else {
        // Use the first required column with uuid or integer type as PK heuristic
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
 * Returns: [{ name, parameters: [{ name, type, format, required }] }]
 */
function parseRpcs(spec) {
  const rpcs = [];

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    if (!path.startsWith('/rpc/')) continue;
    const name = path.replace('/rpc/', '');
    const post = methods.post;
    if (!post) continue;

    const bodyParam = post.parameters?.find(p => p.in === 'body');
    const props = bodyParam?.schema?.properties || {};
    const required = new Set(bodyParam?.schema?.required || []);

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
 * PostgREST uses various formats: "primary key", "<pk/>", "Primary Key", etc.
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
