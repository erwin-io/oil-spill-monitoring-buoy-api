import {test} from 'node:test';import assert from 'node:assert/strict';import spec from '../src/swagger.js';
test('Swagger is a readable OpenAPI document',()=>{assert.equal(spec.openapi,'3.0.3');assert.ok(spec.paths['/api/v1/device/measurements'].post);assert.ok(spec.paths['/api/v1/devices/{deviceId}/config'].get);assert.ok(spec.components.securitySchemes.deviceKey)});
test('all documented paths start at health or /api/v1',()=>{for(const p of Object.keys(spec.paths))assert.ok(p==='/health'||p.startsWith('/api/v1/'))});
