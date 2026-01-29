import { z, type ZodTypeAny } from 'zod';

export function jsonSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.unknown();
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    const values = schema.enum as [string, ...string[]];
    if (values.length > 0) {
      return z.enum(values as [string, ...string[]]);
    }
    return z.string();
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const schemas = (schema.oneOf as Record<string, unknown>[]).map(s => jsonSchemaToZod(s));
    if (schemas.length === 0) return z.unknown();
    if (schemas.length === 1) return schemas[0]!;
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)]);
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const schemas = (schema.anyOf as Record<string, unknown>[]).map(s => jsonSchemaToZod(s));
    if (schemas.length === 0) return z.unknown();
    if (schemas.length === 1) return schemas[0]!;
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)]);
  }

  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  let result: ZodTypeAny;

  switch (type) {
    case 'string': {
      let s = z.string();
      if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
      if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength);
      result = s;
      break;
    }

    case 'number':
    case 'integer': {
      let n = type === 'integer' ? z.number().int() : z.number();
      if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
      if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
      result = n;
      break;
    }

    case 'boolean':
      result = z.boolean();
      break;

    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined;
      const itemSchema = items ? jsonSchemaToZod(items) : z.unknown();
      result = z.array(itemSchema);
      break;
    }

    case 'object': {
      result = jsonSchemaObjectToZodObject(schema);
      break;
    }

    case 'null':
      result = z.null();
      break;

    default:
      result = z.unknown();
      break;
  }

  if (description) {
    result = result.describe(description);
  }

  return result;
}

export function jsonSchemaObjectToZodObject(schema: Record<string, unknown>): z.ZodObject<any> {
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required || []) as string[];

  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let zodProp = jsonSchemaToZod(propSchema);
    if (!required.includes(key)) {
      zodProp = zodProp.optional();
    }
    shape[key] = zodProp;
  }

  return z.object(shape).passthrough();
}