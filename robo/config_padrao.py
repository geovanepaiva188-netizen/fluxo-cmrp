"""Configuração inicial (o administrador muda tudo isso pelo app, em Ajustes)."""

CONFIG_GERAL = {
    'imap': {'host': 'email-ssl.com.br', 'porta': 993, 'pastaEnviados': ''},
    'diasIniciais': 20,
    'aprovadores': [
        {'nome': 'Sandra', 'emails': ['sandra@cearamendes.com.br']},
        {'nome': 'Adriana', 'emails': ['adriana@cearamendes.com.br']},
        {'nome': 'UICF', 'emails': ['uicf@cearamendes.com.br']},
    ],
    'etapasIniciais': [
        {'nome': 'Matheus', 'emails': ['matheus@cearamendes.com.br']},
    ],
    'substitutos': [],
    'permitirAprovacaoDireta': True,
    'palavrasAprovacao': ['autorizado', 'autorizada', 'aprovado', 'aprovada', 'de acordo', 'liberado', 'liberada',
                          'pode pagar', 'pode seguir', 'ok pode', 'deferido'],
    'palavrasDevolucao': ['corrigir', 'corrija', 'ajustar', 'ajuste', 'inserir no dd', 'incluir no dd', 'refazer',
                          'devolvo', 'devolvendo', 'falta', 'faltando', 'nao autorizo', 'nao aprovo', 'reenviar',
                          'reenvie', 'favor verificar', 'favor revisar', 'rever', 'aguardar', 'segurar', 'suspender'],
    'responder': {
        'remetentes': ['mariana@cearamendes.com.br', 'suedy@cearamendes.com.br', 'dp@cearamendes.com.br',
                       'recepcao@cearamendes.com.br'],
        'modo': 'tudo',
        'palavras': ['?', 'favor', 'solicito', 'pendente', 'precisamos', 'preciso', 'poderia', 'urgente'],
    },
    'avisos': {'diasLembreteResponder': 2, 'diasParado': 5},
    'maquinas': {'diasTolerancia': 5},
}

OBRAS = [
    {'codigo': '148', 'nome': 'Sertão', 'empresa': 'Consórcio CMRP', 'aliases': ['148', 'Sertão', 'Sertao'], 'pasta': '148 - Sertão', 'ativa': True},
    {'codigo': '153', 'nome': 'Caturité', 'empresa': 'Consórcio CMRP', 'aliases': ['153', 'Caturité', 'Caturite', 'CMRP CATURITE'], 'pasta': '153 - Caturité', 'ativa': True},
    {'codigo': '157', 'nome': 'Nova Olinda', 'empresa': 'Construtora Ceará Mendes', 'aliases': ['157', 'Nova Olinda'], 'pasta': '157 - Nova Olinda', 'ativa': True},
    {'codigo': '162', 'nome': 'Borborema II', 'empresa': 'Consórcio CMRP', 'aliases': ['162', 'Borborema II', 'Borborema'], 'pasta': '162 - Borborema II', 'ativa': True},
    {'codigo': 'ANITA', 'nome': 'Anita Cabral', 'empresa': 'Construtora Ceará Mendes', 'aliases': ['Anita Cabral', 'Escola Anita Cabral'], 'pasta': 'Anita Cabral', 'ativa': True},
    {'codigo': 'CCM', 'nome': 'CCM', 'empresa': 'Construtora Ceará Mendes', 'aliases': ['CCM'], 'pasta': 'CCM', 'ativa': True},
]
