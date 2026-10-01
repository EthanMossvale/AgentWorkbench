"""Synthetic files only; run on Linux as well to exercise descriptor deletion."""
import base64
import copy
import hashlib
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services' / 'vps-account-broker'))
from runtime import GeneratedImageReceipts, RuntimeErrorCode

DATA = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')

def rejected(callback, code):
    try:
        callback()
    except RuntimeErrorCode as error:
        assert str(error) == code, str(error)
    else:
        raise AssertionError('Expected ' + code)

with tempfile.TemporaryDirectory(prefix='awb-image-receipt-') as temporary:
    profile = Path(temporary)
    image = profile / 'generated_images' / 'thread' / 'image.png'
    image.parent.mkdir(parents=True)
    image.write_bytes(DATA)
    history = profile / 'native-history-fixture.jsonl'
    history.write_bytes(b'SYNTHETIC_HISTORY_REMAINS_NATIVE_OWNED')
    owner = os.getuid() if hasattr(os, 'getuid') else 0
    receipts = GeneratedImageReceipts(profile, owner)
    event = {'method': 'item/completed', 'params': {'threadId': 'thread', 'turnId': 'turn', 'item': {'type': 'imageGeneration', 'id': 'image', 'status': 'completed', 'result': base64.b64encode(DATA).decode(), 'savedPath': str(image)}}}
    ack = {'threadId': 'thread', 'turnId': 'turn', 'itemId': 'image', 'sha256': hashlib.sha256(DATA).hexdigest(), 'size': len(DATA)}
    rejected(lambda: receipts.acknowledge(ack), 'IMAGE_RECEIPT_NOT_OWNED')
    receipts.observe(event)
    assert image.exists(), 'No receipt means no deletion'
    for patch in ({'threadId': 'foreign'}, {'turnId': 'other'}, {'itemId': 'other'}, {'sha256': '0' * 64}, {'size': 1}):
        rejected(lambda: receipts.acknowledge(dict(ack, **patch)), 'IMAGE_RECEIPT_NOT_OWNED')
    rejected(lambda: receipts.acknowledge(dict(ack, savedPath=str(image))), 'IMAGE_RECEIPT_INVALID')
    assert 'result' not in str(receipts.records), 'The receipt registry does not retain image bytes'
    secure = hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY')
    if secure:
        image.write_bytes(b'x' * len(DATA))
        rejected(lambda: receipts.acknowledge(ack), 'IMAGE_CLEANUP_UNCONFIRMED')
        image.write_bytes(DATA)
        assert receipts.acknowledge(ack) == {'removed': True}
        assert not image.exists()
        assert receipts.acknowledge(ack) == {'removed': True}, 'Lost acknowledgement may be read again safely'
        image.write_bytes(DATA)
        assert receipts.acknowledge(ack) == {'removed': True}
        assert image.exists(), 'Idempotent receipt must not delete a later replacement'
        for kind in ('symlink', 'hardlink', 'parent-link'):
            receipts = GeneratedImageReceipts(profile, owner)
            receipts.observe(event)
            outside = profile / ('outside-' + kind + '.png')
            outside.write_bytes(DATA)
            image.unlink()
            if kind == 'symlink':
                image.symlink_to(outside)
            elif kind == 'hardlink':
                os.link(outside, image)
            else:
                image.parent.rmdir()
                target = profile / 'external-dir'
                target.mkdir()
                (target / image.name).write_bytes(DATA)
                image.parent.symlink_to(target, target_is_directory=True)
            rejected(lambda: receipts.acknowledge(ack), 'IMAGE_CLEANUP_UNCONFIRMED')
            assert outside.read_bytes() == DATA
            if kind != 'parent-link':
                image.unlink()
                image.write_bytes(DATA)
    else:
        rejected(lambda: receipts.acknowledge(ack), 'IMAGE_CLEANUP_UNCONFIRMED')
        assert image.read_bytes() == DATA
    assert history.read_bytes() == b'SYNTHETIC_HISTORY_REMAINS_NATIVE_OWNED'
    wrong = copy.deepcopy(event)
    wrong['params']['item']['savedPath'] = str(profile / 'unrelated.png')
    unmatched = GeneratedImageReceipts(profile, owner)
    unmatched.observe(wrong)
    rejected(lambda: unmatched.acknowledge(ack), 'IMAGE_RECEIPT_NOT_OWNED')
    failed = copy.deepcopy(event)
    failed['params']['item']['status'] = 'failed'
    unmatched.observe(failed)
    assert not unmatched.records
    print('PASS image receipt validation; secure deletion=' + str(secure))
