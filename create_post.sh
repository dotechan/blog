#!/bin/sh -e

CMDNAME=`basename $0`

if [ $# -ne 1 ]; then
    echo "Usage: $CMDNAME file_name" 1>&2
    echo "指定された引数は$#個です。引数は1個だけ指定してください。" 1>&2
    echo "実行するにはcontent/post/配下に生成するファイル名を引数として指定してください。"
    exit 1
fi

# content/post/にadco形式の記事を作成する
echo "create content/post/$1.adoc"
hugo new post/$1.adoc

exit 0

