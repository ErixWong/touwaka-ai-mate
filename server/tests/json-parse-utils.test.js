import { expect } from 'chai';
import { parseJsonLikeContent } from '../../lib/json-parse-utils.js';

describe('parseJsonLikeContent', () => {
  describe('pure JSON', () => {
    it('should parse valid JSON object', () => {
      const result = parseJsonLikeContent('{ "status": "success", "progress": 50 }');
      expect(result).to.deep.equal({ status: 'success', progress: 50 });
    });

    it('should parse valid JSON array', () => {
      const result = parseJsonLikeContent('[1, 2, 3]');
      expect(result).to.deep.equal([1, 2, 3]);
    });

    it('should parse JSON with _raw field without false negative', () => {
      const input = '{ "_raw": "source text", "status": "ok" }';
      const result = parseJsonLikeContent(input);
      expect(result).to.deep.equal({ _raw: 'source text', status: 'ok' });
      expect(result).to.not.have.property('_parse_failed');
    });
  });

  describe('code block wrapped JSON', () => {
    it('should parse JSON wrapped in ```json```', () => {
      const input = '```json\n{ "status": "done" }\n```';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'done' });
    });

    it('should parse JSON wrapped in ``` (no lang)', () => {
      const input = '```\n{ "status": "done" }\n```';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'done' });
    });
  });

  describe('mixed text with JSON', () => {
    it('should extract JSON object from mixed text', () => {
      const input = 'Here is the result: { "status": "success", "progress": 100 } Done.';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'success', progress: 100 });
    });

    it('should extract JSON array from mixed text', () => {
      const input = 'The items are: [1, 2, 3] as requested.';
      expect(parseJsonLikeContent(input)).to.deep.equal([1, 2, 3]);
    });
  });

  describe('fallback behavior', () => {
    it('should return _parse_failed marker on failure with returnRawOnFail=true', () => {
      const result = parseJsonLikeContent('plain text without JSON', { returnRawOnFail: true });
      expect(result).to.have.property('_parse_failed');
      expect(result._parse_failed).to.equal(true);
      expect(result).to.have.property('_raw');
      expect(result._raw).to.equal('plain text without JSON');
    });

    it('should return null on complete failure with returnRawOnFail=false', () => {
      const result = parseJsonLikeContent('plain text without JSON', { returnRawOnFail: false });
      expect(result).to.be.null;
    });

    it('should return _parse_failed marker for empty string with returnRawOnFail=true', () => {
      const result = parseJsonLikeContent('', { returnRawOnFail: true });
      expect(result).to.have.property('_parse_failed');
      expect(result._raw).to.equal('');
    });

    it('should return null for null/undefined input with returnRawOnFail=false', () => {
      expect(parseJsonLikeContent(null, { returnRawOnFail: false })).to.be.null;
      expect(parseJsonLikeContent(undefined, { returnRawOnFail: false })).to.be.null;
    });
  });

  describe('edge cases', () => {
    it('should handle nested JSON objects', () => {
      const input = '{ "outer": { "inner": "value" } }';
      expect(parseJsonLikeContent(input)).to.deep.equal({ outer: { inner: 'value' } });
    });

    it('should handle JSON with whitespace', () => {
      const input = '  {  "key"  :  "value"  }  ';
      expect(parseJsonLikeContent(input)).to.deep.equal({ key: 'value' });
    });
  });
});