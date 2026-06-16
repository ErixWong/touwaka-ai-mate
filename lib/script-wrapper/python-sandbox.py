#!/usr/bin/env python3
"""
Python Script Sandbox Wrapper

Usage: python python-sandbox.py <sandbox_root> <script_path> [args...]

This wrapper:
1. Takes over open/__import__/pathlib with path restrictions
2. Restricts all file operations to sandbox_root
3. Loads and executes user script

Environment variables (minimal whitelist):
- SANDBOX_ROOT: Absolute path to sandbox root
- DATA_BASE_PATH: Data directory path
- USER_ID: User ID
- EXPERT_ID: Expert ID
"""

import sys
import os
import json
import importlib.util
import traceback

SANDBOX_ROOT = os.environ.get('SANDBOX_ROOT', '')

if len(sys.argv) < 2:
    sys.stderr.write('Usage: python python-sandbox.py <script_path> [args...]\n')
    sys.stderr.write('SANDBOX_ROOT must be set via environment variable\n')
    sys.exit(1)

if not SANDBOX_ROOT:
    sys.stderr.write('SANDBOX_ROOT environment variable must be set\n')
    sys.exit(1)

script_path = sys.argv[1]
script_args = sys.argv[2:]

SANDBOX_ROOT_RESOLVED = os.path.abspath(os.path.normpath(SANDBOX_ROOT))

if not os.path.exists(SANDBOX_ROOT_RESOLVED):
    sys.stderr.write(f'Sandbox root does not exist: {SANDBOX_ROOT_RESOLVED}\n')
    sys.exit(1)

_original_open = open
_original_import = __builtins__.__import__ if isinstance(__builtins__, dict) else __builtins__.__import__

_allowed_modules = {
    'os', 'sys', 'json', 'math', 're', 'datetime', 'time', 'collections',
    'itertools', 'functools', 'typing', 'string', 'random', 'copy',
    'pathlib', 'io', 'csv', 'xml', 'html', 'urllib', 'http',
    'hashlib', 'hmac', 'base64', 'binascii', 'struct',
    'textwrap', 'unicodedata', 'locale', 'gettext',
    'logging', 'warnings', 'contextlib', 'dataclasses',
    'enum', 'types', 'inspect', 'dis', 'ast',
    'abc', 'numbers', 'decimal', 'fractions',
    'statistics', 'array', 'weakref', 'pprint',
    'reprlib', 'operator', 'pickle', 'shelve', 'marshal',
    'codecs', 'codeop', 'code', 'graphlib',
    'difflib', 'filecmp', 'fnmatch', 'glob',
    'shlex', 'configparser', 'netrc', 'mailbox',
    'mimetypes', 'quopri', 'uu', 'email',
    'mailbox', 'mimetypes', 'base64', 'binascii',
    'platform', 'errno', 'ctypes', 'threading',
    'multiprocessing', 'concurrent', 'asyncio',
    'selectors', 'socket', 'ssl', 'select',
    'signal', 'mmap', 'resource', 'syslog',
}

def _check_path(file_path):
    """Check if path is within sandbox root"""
    abs_path = os.path.abspath(os.path.normpath(file_path))
    sandbox_abs = os.path.abspath(os.path.normpath(SANDBOX_ROOT_RESOLVED))
    
    if abs_path == sandbox_abs:
        return abs_path
    
    if not abs_path.startswith(sandbox_abs + os.sep):
        raise PermissionError(
            f"Path not allowed in sandbox: {abs_path}\n"
            f"Sandbox root: {sandbox_abs}"
        )
    
    return abs_path

def _restricted_open(file, mode='r', *args, **kwargs):
    """Restricted open function that checks path permissions"""
    _check_path(file)
    return _original_open(file, mode, *args, **kwargs)

def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    """Restricted import function that blocks non-whitelisted modules"""
    base_name = name.split('.')[0] if '.' in name else name
    
    if base_name not in _allowed_modules and name not in _allowed_modules:
        raise ImportError(
            f"Module '{name}' is not allowed in sandbox.\n"
            f"Allowed modules: {sorted(_allowed_modules)}"
        )
    
    return _original_import(name, globals, locals, fromlist, level)

class RestrictedPath:
    """Restricted pathlib.Path that enforces sandbox boundaries"""
    
    def __init__(self, *args, **kwargs):
        self._original_path = __import__('pathlib').Path(*args, **kwargs)
        self._path = self._original_path
    
    def __str__(self):
        return str(self._path)
    
    def __repr__(self):
        return repr(self._path)
    
    def __fspath__(self):
        result = self._path.__fspath__()
        _check_path(result)
        return result
    
    def _check_and_return(self, method_name, *args, **kwargs):
        result = getattr(self._path, method_name)(*args, **kwargs)
        if isinstance(result, __import__('pathlib').Path):
            _check_path(str(result))
            return RestrictedPath(str(result))
        return result
    
    def resolve(self, strict=False):
        result = self._path.resolve(strict=strict)
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def absolute(self):
        result = self._path.absolute()
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def exists(self):
        _check_path(str(self._path))
        return self._path.exists()
    
    def is_file(self):
        _check_path(str(self._path))
        return self._path.is_file()
    
    def is_dir(self):
        _check_path(str(self._path))
        return self._path.is_dir()
    
    def read_text(self, encoding=None, errors=None):
        _check_path(str(self._path))
        return self._path.read_text(encoding=encoding, errors=errors)
    
    def read_bytes(self):
        _check_path(str(self._path))
        return self._path.read_bytes()
    
    def write_text(self, data, encoding=None, errors=None, newline=None):
        _check_path(str(self._path))
        return self._path.write_text(data, encoding=encoding, errors=errors, newline=newline)
    
    def write_bytes(self, data):
        _check_path(str(self._path))
        return self._path.write_bytes(data)
    
    def open(self, mode='r', buffering=-1, encoding=None, errors=None, newline=None):
        _check_path(str(self._path))
        return self._path.open(mode=mode, buffering=buffering, encoding=encoding, errors=errors, newline=newline)
    
    def mkdir(self, mode=0o777, parents=False, exist_ok=False):
        _check_path(str(self._path))
        return self._path.mkdir(mode=mode, parents=parents, exist_ok=exist_ok)
    
    def rmdir(self):
        _check_path(str(self._path))
        return self._path.rmdir()
    
    def unlink(self, missing_ok=False):
        _check_path(str(self._path))
        return self._path.unlink(missing_ok=missing_ok)
    
    def rename(self, target):
        _check_path(str(self._path))
        _check_path(str(target))
        return self._path.rename(target)
    
    def replace(self, target):
        _check_path(str(self._path))
        _check_path(str(target))
        return self._path.replace(target)
    
    def copy(self, target):
        _check_path(str(self._path))
        _check_path(str(target))
        import shutil
        return shutil.copy2(str(self._path), str(target))
    
    def touch(self, mode=0o666, exist_ok=True):
        _check_path(str(self._path))
        return self._path.touch(mode=mode, exist_ok=exist_ok)
    
    def with_name(self, name):
        result = self._path.with_name(name)
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def with_suffix(self, suffix):
        result = self._path.with_suffix(suffix)
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def with_stem(self, stem):
        result = self._path.with_stem(stem)
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def joinpath(self, *args):
        result = self._path.joinpath(*args)
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def __truediv__(self, other):
        result = self._path / other
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    def __rtruediv__(self, other):
        result = other / self._path
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    @property
    def parent(self):
        result = self._path.parent
        _check_path(str(result))
        return RestrictedPath(str(result))
    
    @property
    def parents(self):
        return tuple(RestrictedPath(str(p)) for p in self._path.parents)
    
    @property
    def name(self):
        return self._path.name
    
    @property
    def stem(self):
        return self._path.stem
    
    @property
    def suffix(self):
        return self._path.suffix
    
    @property
    def suffixes(self):
        return self._path.suffixes
    
    def glob(self, pattern):
        _check_path(str(self._path))
        for p in self._path.glob(pattern):
            try:
                _check_path(str(p))
                yield RestrictedPath(str(p))
            except PermissionError:
                continue
    
    def rglob(self, pattern):
        _check_path(str(self._path))
        for p in self._path.rglob(pattern):
            try:
                _check_path(str(p))
                yield RestrictedPath(str(p))
            except PermissionError:
                continue
    
    def iterdir(self):
        _check_path(str(self._path))
        for p in self._path.iterdir():
            try:
                _check_path(str(p))
                yield RestrictedPath(str(p))
            except PermissionError:
                continue

script_full_path = os.path.abspath(os.path.normpath(os.path.join(SANDBOX_ROOT_RESOLVED, script_path)))

if not script_full_path.startswith(SANDBOX_ROOT_RESOLVED + os.sep) and \
   script_full_path != SANDBOX_ROOT_RESOLVED:
    sys.stderr.write(f'Script path must be within sandbox: {script_path}\n')
    sys.exit(1)

if not os.path.exists(script_full_path):
    sys.stderr.write(f'Script file not found: {script_path}\n')
    sys.exit(1)

ext = os.path.splitext(script_full_path)[1].lower()
if ext != '.py':
    sys.stderr.write(f'Script must be .py: {script_path}\n')
    sys.exit(1)

_real_os = _original_import('os')
_real_sys = _original_import('sys')

_os_dangerous = {
    'system', 'popen', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe',
    'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',
    'execv', 'execve', 'execvp', 'execvpe',
    'execl', 'execle', 'execlp', 'execlpe',
    'fork', 'kill',
}

def _make_denied_func(name):
    def _denied(*args, **kwargs):
        raise PermissionError(f"os.{name} is not allowed in sandbox")
    _denied.__name__ = name
    return _denied

for _func in _os_dangerous:
    if hasattr(_real_os, _func):
        setattr(_real_os, _func, _make_denied_func(_func))

_real_os.environ = {
    'SANDBOX_ROOT': SANDBOX_ROOT_RESOLVED,
    'DATA_BASE_PATH': os.environ.get('DATA_BASE_PATH', ''),
    'USER_ID': os.environ.get('USER_ID', ''),
    'EXPERT_ID': os.environ.get('EXPERT_ID', ''),
}

_real_sys.path = [SANDBOX_ROOT_RESOLVED]

restricted_globals = {
    '__name__': '__main__',
    '__file__': script_full_path,
    '__doc__': None,
    '__package__': None,
    '__loader__': None,
    '__spec__': None,
    '__annotations__': {},
    '__builtins__': {
        'open': _restricted_open,
        '__import__': _restricted_import,
        'print': print,
        'input': input,
        'len': len,
        'range': range,
        'str': str,
        'int': int,
        'float': float,
        'bool': bool,
        'list': list,
        'dict': dict,
        'tuple': tuple,
        'set': set,
        'frozenset': frozenset,
        'bytes': bytes,
        'bytearray': bytearray,
        'memoryview': memoryview,
        'complex': complex,
        'type': type,
        'isinstance': isinstance,
        'issubclass': issubclass,
        'callable': callable,
        'hasattr': hasattr,
        'getattr': getattr,
        'setattr': setattr,
        'delattr': delattr,
        'property': property,
        'super': super,
        'object': object,
        'None': None,
        'True': True,
        'False': False,
        'Ellipsis': Ellipsis,
        'NotImplemented': NotImplemented,
        'abs': abs,
        'all': all,
        'any': any,
        'bin': bin,
        'chr': chr,
        'ord': ord,
        'divmod': divmod,
        'filter': filter,
        'format': format,
        'hex': hex,
        'id': id,
        'iter': iter,
        'next': next,
        'map': map,
        'max': max,
        'min': min,
        'oct': oct,
        'pow': pow,
        'repr': repr,
        'reversed': reversed,
        'round': round,
        'sorted': sorted,
        'sum': sum,
        'zip': zip,
        'enumerate': enumerate,
        'slice': slice,
        'breakpoint': breakpoint,
        'classmethod': classmethod,
        'staticmethod': staticmethod,
        'exec': exec,
        'eval': eval,
        'compile': compile,
        'globals': globals,
        'locals': locals,
        'vars': vars,
        'dir': dir,
        'help': help,
        'hash': hash,
        'exit': exit,
        'quit': quit,
    },
    'os': _real_os,
    'sys': _real_sys,
    'pathlib': type('pathlib', (), {
        'Path': RestrictedPath,
    }),
    'json': __import__('json'),
}

with open(script_full_path, 'r', encoding='utf-8') as f:
    script_code = f.read()

try:
    exec(compile(script_code, script_full_path, 'exec'), restricted_globals)
    sys.exit(0)
except PermissionError as e:
    sys.stderr.write(f'Permission denied: {e}\n')
    sys.exit(1)
except Exception as e:
    sys.stderr.write(f'Script execution failed: {e}\n')
    traceback.print_exc()
    sys.exit(1)