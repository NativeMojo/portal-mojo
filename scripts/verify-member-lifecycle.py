"""Real Chromium regression. All API requests are intercepted; no invitations leave this fixture.
Run with its isolated Vite fixture: node scripts/member-lifecycle-server.mjs
then uv run --with playwright python scripts/verify-member-lifecycle.py.
"""
import asyncio
import re
import os
from pathlib import Path
from playwright.async_api import async_playwright

ROW = dict(id=103, created=1, modified=1, is_active=True, permissions={'manage_kiosks': True}, metadata={}, group=dict(id=10, name='Fixture fleet', kind='fleet'), user=dict(id=3, display_name='Fixture Member', email='fixture@example.test'))

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome', headless=True)
        for theme in ('light', 'dark'):
            for change in ('account', 'account-back', 'group', 'group-back', 'dismiss', 'owner', 'normal', 'label-failure', 'empty', 'refused'):
                page = await browser.new_page(viewport={'width': 1000, 'height': 800})
                writes, errors = [], []
                release, started = asyncio.Event(), asyncio.Event()
                page.on('pageerror', lambda error: errors.append(str(error)))
                async def route_handler(route):
                    request = route.request
                    path = request.url.split(':5296')[-1].split('?')[0]
                    if request.method == 'POST':
                        writes.append({'path': path, 'body': request.post_data_json})
                        if path.endswith('/invite'):
                            started.set()
                            await release.wait()
                        if (change == 'label-failure' and path.endswith('/103')) or change == 'refused':
                            await route.fulfill(status=403, json={'status': False, 'error': 'label denied'})
                            return
                        await route.fulfill(json={'status': True, 'data': None if change == 'empty' else ROW})
                    elif path == '/api/user/me':
                        await route.fulfill(json={'status': True, 'data': {'id': 1, 'is_superuser': True, 'permissions': {}}})
                    else:
                        await route.fulfill(json={'status': True, 'data': ROW})
                await page.route('**/api/**', route_handler)
                await page.goto('http://127.0.0.1:5296')
                await page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                await page.get_by_role('button', name='Invite fixture').click()
                await page.locator('input[type=email]').fill('fixture@example.test')
                await page.get_by_role('button', name='Send invitation').click()
                await asyncio.wait_for(started.wait(), 5)
                if change.startswith('account'):
                    await page.evaluate('fixture.switchAccount()')
                    if change == 'account-back': await page.evaluate('fixture.switchBack()')
                elif change.startswith('group'):
                    await page.evaluate('fixture.switchGroup()')
                    if change == 'group-back': await page.evaluate('fixture.switchBack()')
                elif change == 'owner': await page.evaluate('fixture.abortOwner()')
                elif change == 'dismiss':
                    await page.evaluate('fixture.close()')
                release.set()
                await page.wait_for_timeout(250)
                state = await page.evaluate('fixture.state()')
                expected = 2 if change in ('normal', 'label-failure') else 1
                assert len(writes) == expected, (theme, change, writes)
                assert writes[0]['body']['permissions'] == {'manage_kiosks': True}
                if change in ('account', 'account-back', 'group', 'group-back', 'dismiss', 'owner', 'refused'):
                    assert state['notices'] == [] and state['created'] == 0 and state['invalidations'] == 0, (change, state)
                else:
                    assert state['notices'] == ['Invitation request accepted'] and state['created'] == (0 if change == 'empty' else 1) and state['invalidations'] == 1, state
                if change == 'refused':
                    assert await page.locator('.form-alert').inner_text() == 'label denied'
                assert not errors, errors
                print(f'{theme}: {change} invitation verified')
                await page.close()
                if os.environ.get('MEMBER_REGRESSION_CASE') == 'account':
                    await browser.close()
                    return
            for action in ('deactivate', 'permission', 'role', 'resend'):
                for change in ('account', 'group', 'dismiss', 'owner', 'late-success', 'normal', 'refused'):
                    page = await browser.new_page(viewport={'width': 1000, 'height': 800})
                    writes, errors = [], []
                    release, started = asyncio.Event(), asyncio.Event()
                    row = {**ROW, 'metadata': {}, 'permissions': {}}
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    async def detail_route(route):
                        request = route.request
                        path = request.url.split(':5296')[-1].split('?')[0]
                        if request.method == 'POST':
                            writes.append(request.post_data_json)
                            started.set()
                            await release.wait()
                            if change in ('refused', 'account', 'group', 'dismiss'):
                                await route.fulfill(status=403, json={'status': False, 'error': 'fixture refusal'})
                                return
                            row.update(request.post_data_json)
                        if path == '/api/user/me':
                            data = {'id': 1, 'is_superuser': True, 'permissions': {}}
                        else:
                            data = row
                        await route.fulfill(json={'status': True, 'data': data})
                    await page.route('**/api/**', detail_route)
                    await page.goto('http://127.0.0.1:5296')
                    await page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                    await page.evaluate('void fixture.detail()')
                    await page.get_by_text('Fixture Member in Fixture fleet', exact=True).wait_for()
                    before = await page.evaluate('fixture.state()')
                    if action == 'deactivate':
                        await page.locator('.detail-header input[role=switch], .detail-head input[role=switch], input[role=switch]').first.click()
                    elif action == 'permission':
                        await page.get_by_role('button', name=re.compile(r'Permissions$')).click()
                        await page.get_by_role('switch', name='View Members', exact=True).click()
                    elif action == 'resend':
                        await page.get_by_role('button', name='More actions', exact=True).click()
                        await page.get_by_role('menuitem', name=re.compile(r'Resend invitation$')).click()
                    else:
                        await page.locator('.flat-row').filter(has_text='Role label').get_by_role('button').click()
                        await page.locator('dialog input[type=text]').fill('Fixture role')
                        await page.get_by_role('button', name='Update label').click()
                    await asyncio.wait_for(started.wait(), 5)
                    if change in ('account', 'late-success'): await page.evaluate('fixture.switchAccount()')
                    elif change == 'group': await page.evaluate('fixture.switchGroup()')
                    elif change == 'dismiss': await page.evaluate('fixture.close()')
                    elif change == 'owner': await page.evaluate('fixture.abortOwner()')
                    release.set()
                    await page.wait_for_timeout(250)
                    state = await page.evaluate('fixture.state()')
                    assert len(writes) == 1, (action, change, writes)
                    if change in ('account', 'group', 'dismiss', 'owner', 'late-success'):
                        assert state['notices'] == [] and state['invalidations'] == before['invalidations'], (action, change, state)
                        assert state['cached'] == before['cached'], (action, change, state)
                    elif change == 'normal':
                        assert state['invalidations'] == before['invalidations'] + 1, state
                        assert state['cached'].get('is_active') == (action != 'deactivate'), state
                        if action == 'permission': assert state['cached']['permissions']['view_members'] is True, state
                        if action == 'role': assert state['cached']['metadata']['role'] == 'Fixture role', state
                    else:
                        assert state['cached'] == before['cached'], state
                        assert state['notices'] == ['fixture refusal'] or await page.locator('.form-alert').inner_text() == 'fixture refusal', state
                    assert not errors, errors
                    if change == 'normal':
                        out = Path(os.environ.get('MEMBER_EVIDENCE_DIR', '/tmp/member-lifecycle-evidence'))
                        out.mkdir(exist_ok=True)
                        await page.screenshot(path=str(out / f'{theme}-{action}.png'))
                        if action == 'role':
                            for width in (390, 320):
                                await page.set_viewport_size({'width': width, 'height': 844})
                                await page.screenshot(path=str(out / f'{theme}-{action}-{width}.png'))
                                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
                    print(f'{theme}: {action} / {change} verified')
                    await page.close()
            for change in ('account', 'group', 'owner', 'normal'):
                page = await browser.new_page(viewport={'width': 1000, 'height': 800})
                writes = []
                async def confirm_route(route):
                    request = route.request
                    path = request.url.split(':5296')[-1].split('?')[0]
                    if request.method == 'POST': writes.append(request.post_data_json)
                    data = {'id': 1, 'is_superuser': True, 'permissions': {}} if path == '/api/user/me' else ROW
                    await route.fulfill(json={'status': True, 'data': data})
                await page.route('**/api/**', confirm_route)
                await page.goto('http://127.0.0.1:5296')
                await page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                await page.evaluate('void fixture.detail()')
                await page.get_by_role('button', name=re.compile(r'Permissions$')).click()
                await page.get_by_role('switch', name='Manage Group', exact=True).click()
                confirm = page.get_by_role('button', name='Grant Manage Group', exact=True)
                await confirm.wait_for()
                if change == 'account': await page.evaluate('fixture.switchAccount()')
                elif change == 'group': await page.evaluate('fixture.switchGroup()')
                elif change == 'owner': await page.evaluate('fixture.abortOwner()')
                else: await confirm.click()
                await page.wait_for_timeout(200)
                assert not await confirm.count(), change
                assert len(writes) == (1 if change == 'normal' else 0), (change, writes)
                if writes: assert writes[0] == {'permissions': {'manage_group': True}}, writes
                print(f'{theme}: escalation confirmation / {change} verified')
                await page.close()
        await browser.close()

asyncio.run(run())
