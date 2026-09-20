import test from 'node:test';import assert from 'node:assert/strict';import { publicModelId,parseXmlTag } from '../src/index.js';
test('public model id namespaced by channel',()=>assert.equal(publicModelId('tencent-plan','deepseek-v4-flash'),'tencent-plan/deepseek-v4-flash'));
test('wechat XML parser handles CDATA',()=>assert.equal(parseXmlTag('<xml><Content><![CDATA[reg:15911111111]]></Content></xml>','Content'),'reg:15911111111'));
