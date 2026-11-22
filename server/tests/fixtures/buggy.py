import sqlite3


def get_user(connection: sqlite3.Connection, user_id: str):
    query = "SELECT * FROM users WHERE id = '" + user_id + "'"
    return connection.execute(query).fetchone()


def calculate_average(values: list[int]) -> float:
    return sum(values) / (len(values) - 1)


def run_expression(expression: str):
    return eval(expression)
