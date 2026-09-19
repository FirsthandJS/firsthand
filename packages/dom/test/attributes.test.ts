import { beforeEach, describe, expect, it } from 'vitest';
import {
  setAttribute,
  setAttributeNS,
  setBoolean,
  setClass,
  setClassList,
  setProperty,
  setStyle,
  setStyleObject,
} from '../src/attributes.js';

let node: HTMLInputElement;

beforeEach(() => {
  document.body.innerHTML = '';
  node = document.createElement('input');
  document.body.appendChild(node);
});

describe('attribute parts', () => {
  it('sets and removes a plain attribute', () => {
    setAttribute(node, 'data-x', 'one');
    expect(node.getAttribute('data-x')).toBe('one');
    setAttribute(node, 'data-x', 2);
    expect(node.getAttribute('data-x')).toBe('2');
    setAttribute(node, 'data-x', true);
    expect(node.getAttribute('data-x')).toBe('');
    setAttribute(node, 'data-x', null);
    expect(node.hasAttribute('data-x')).toBe(false);
    setAttribute(node, 'data-x', 'back');
    setAttribute(node, 'data-x', false);
    expect(node.hasAttribute('data-x')).toBe(false);
  });

  it('sets and removes a namespaced attribute', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const ns = 'http://www.w3.org/1999/xlink';
    setAttributeNS(svg, ns, 'href', '#icon');
    expect(svg.getAttributeNS(ns, 'href')).toBe('#icon');
    setAttributeNS(svg, ns, 'href', true);
    expect(svg.getAttributeNS(ns, 'href')).toBe('');
    setAttributeNS(svg, ns, 'href', null);
    expect(svg.getAttributeNS(ns, 'href')).toBeNull();
  });

  it('writes DOM properties, including aliased names', () => {
    setProperty(node, 'value', 'typed');
    expect(node.value).toBe('typed');
    setProperty(node, 'class', 'a b');
    expect(node.className).toBe('a b');
    const label = document.createElement('label');
    setProperty(label, 'for', 'field');
    expect(label.htmlFor).toBe('field');
  });

  it('passes object props through without serialising them', () => {
    const payload = { nested: {} };
    setProperty(node, 'dataPayload', payload);
    expect((node as unknown as Record<string, unknown>)['dataPayload']).toBe(payload);
  });

  it('coerces boolean properties', () => {
    setBoolean(node, 'disabled', 1);
    expect(node.disabled).toBe(true);
    setBoolean(node, 'disabled', 0);
    expect(node.disabled).toBe(false);
  });

  it('sets class as a string and removes it when null', () => {
    setClass(node, 'row active');
    expect(node.getAttribute('class')).toBe('row active');
    setClass(node, null);
    expect(node.hasAttribute('class')).toBe(false);
  });

  it('toggles only the class names that changed', () => {
    setClassList(node, { a: true, b: false }, undefined);
    expect(node.className).toBe('a');
    setClassList(node, { a: true, b: true }, { a: true, b: false });
    expect(node.classList.contains('b')).toBe(true);
    setClassList(node, { b: true }, { a: true, b: true });
    expect(node.classList.contains('a')).toBe(false);
    expect(node.classList.contains('b')).toBe(true);
  });

  it('sets style as a string', () => {
    setStyle(node, 'color: red');
    expect(node.style.color).toBe('red');
    setStyle(node, null);
    expect(node.style.cssText).toBe('');
  });

  it('diffs style objects per property', () => {
    setStyleObject(node, { marginTop: '1px', opacity: 1 }, undefined);
    expect(node.style.marginTop).toBe('1px');
    expect(node.style.opacity).toBe('1');
    setStyleObject(node, { marginTop: '2px', opacity: 1 }, { marginTop: '1px', opacity: 1 });
    expect(node.style.marginTop).toBe('2px');
    setStyleObject(node, { opacity: 1 }, { marginTop: '2px', opacity: 1 });
    expect(node.style.marginTop).toBe('');
    setStyleObject(node, { opacity: null }, { opacity: 1 });
    expect(node.style.opacity).toBe('');
  });

  it('passes custom properties through unhyphenated', () => {
    setStyleObject(node, { '--brand': 'red' }, undefined);
    expect(node.style.getPropertyValue('--brand')).toBe('red');
    setStyleObject(node, { '--brand': 'red' }, { '--brand': 'red' });
    expect(node.style.getPropertyValue('--brand')).toBe('red');
  });
});
