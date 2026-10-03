"""Run actual M3 helper bodies without installing or starting the API.

AST extraction excludes route imports only. Adapter and helper bodies are intact.
This is a boundary reproduction, not a substitute for Postgres integration tests.
"""
import ast
import asyncio
import subprocess
import unittest
import warnings

source = subprocess.check_output(
    ['git', 'show', 'origin/m3-alloc:api/app/alloc/__init__.py'], text=True
)
tree = ast.parse(source)
names = {'_Cursor', '_Transaction', '_Connection', '_one', '_all'}
selected = [node for node in tree.body if getattr(node, 'name', None) in names]
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *selected], type_ignores=[])
ns = {'tuple_row': object()}
exec(compile(ast.fix_missing_locations(module), '<M3 actual adapter/helpers>', 'exec'), ns)


class RawCursor:
    def execute(self, sql, params):
        pass

    def fetchone(self):
        return (1,)

    def fetchall(self):
        return [(1,)]


class RawConnection:
    def cursor(self, **kwargs):
        return RawCursor()


class BackendGates(unittest.IsolatedAsyncioTestCase):
    async def test_G6_one_works_with_the_shipped_connection_adapter(self):
        self.assertEqual(await ns['_one'](ns['_Connection'](RawConnection()), 'SELECT 1'), (1,))

    async def test_G6_all_works_with_the_shipped_connection_adapter(self):
        self.assertEqual(await ns['_all'](ns['_Connection'](RawConnection()), 'SELECT 1'), [(1,)])


if __name__ == '__main__':
    warnings.filterwarnings('ignore', category=RuntimeWarning)
    unittest.main(verbosity=2)
