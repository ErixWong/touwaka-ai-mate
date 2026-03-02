"""
测试 Python 技能
用于验证 skill-runner 的 Python 执行器
"""

import json
import sys


def execute(tool_name, params, context):
    """
    技能入口函数
    
    Args:
        tool_name: 工具名称
        params: 工具参数
        context: 执行上下文
    
    Returns:
        执行结果
    """
    if tool_name == 'echo':
        return {
            'message': params.get('message', 'Hello from Python!'),
            'tool': tool_name,
        }
    
    elif tool_name == 'add':
        a = params.get('a', 0)
        b = params.get('b', 0)
        return {
            'result': a + b,
            'expression': f'{a} + {b} = {a + b}',
        }
    
    elif tool_name == 'get_context':
        return {
            'context': context,
            'python_version': sys.version,
        }
    
    else:
        raise ValueError(f'Unknown tool: {tool_name}')


# 测试代码（直接运行时执行）
if __name__ == '__main__':
    # 模拟 skill-runner 的调用
    test_input = {
        'tool': 'echo',
        'params': {'message': 'Test message'},
        'context': {'user_id': 'test_user'},
    }
    
    result = execute(
        test_input['tool'],
        test_input['params'],
        test_input['context']
    )
    
    print(json.dumps({'success': True, 'data': result}))
